/**
 * Module dependencies
 */

var debug = require('debug')('deploy-yml');
var debugParse = require('debug')('deploy-yml:parser');
var each = require('p-each');
var yaml = require('js-yaml').safeLoad;
var merge = require('utils-merge');
var builder = require('env-builder-cli');

exports = module.exports = Deploy;

/**
 * Load configuration state
 *
 * @param {String} path
 */

function Deploy(path) {
  if (!(this instanceof Deploy)) return new Deploy(path);
  this.path = path;
  this._resolvers = [];
  this._cache = {};
}

/**
 * Use a resolver
 *
 * @param {Function} fn
 */

Deploy.prototype.use = function(fn) {
  this._resolvers.push(fn);
  return this;
};

Deploy.prototype.fetch = function(arr, fn) {
  var self = this;
  each(arr, function(key, cb) {
    if (self[key]) self[key](cb);
    else self.first(key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(), cb);
  }, fn);
  return this;
};

Deploy.prototype.buildpacks = function(fn) {
  return this.all('buildpacks', fn, true);
};

Deploy.prototype.resources = function(fn) {
  return this.all('resources', fn);
};

Deploy.prototype.collaborators = function(fn) {
  return this.all('collaborators', fn);
};

Deploy.prototype.drain = function(fn) {
  return this.all('drain', fn);
};

Deploy.prototype.types = function(fn) {
  return this.all('types', fn);
};

Deploy.prototype.regions = function(fn) {
  return this.all('regions', fn);
};

Deploy.prototype.labs = function(fn) {
  return this.all('labs', fn);
};

Deploy.prototype.env = function(env, fn) {
  if (typeof env === 'function') {
    fn = env;
    env = this.defaultEnv || 'prod';
  }
  var self = this;
  this.fetch(['app', 'types'], function(err, res) {
    if (err) return fn(err);
    var app = res[0];
    var types = res[1] || [];

    var appName = app || 'global';

    var key = appName + '|' + types.join(',') + '|' + env;
    if (self._cache[key]) return fn(null, self._cache[key]);

    self.all('env', function(err, envs) {
      if (typeof envs === 'undefined') return fn(null, {});

      buildEnv(env, types, appName, envs, self, function(err, ENV) {
        if (err) return fn(err);
        self._cache[key] = ENV;
        fn(null, ENV);
      })
    });
  });
  return this;
};

Deploy.prototype.app = function(fn) {
  return this.first('app', fn);
};

Deploy.prototype.domains = function(fn) {
  return this.first('domains', fn);
};

Deploy.prototype.errorPage = function(fn) {
  return this.first('error-page', fn);
};

// generic functions

Deploy.prototype.first = function(name, fn) {
  getOverride(name, this, fn);
  return this;
};

Deploy.prototype.all = function(name, fn, single) {
  getAll(name, this, fn, single);
  return this;
};

// concats have to go all the way down the chain
// overrides work backwards and stop at first definition

function getAll(name, deploy, fn, single) {
  getTree(name, deploy, function(err, tree) {
    if (err) return fn(err);
    var acc = [];
    flatten(tree, acc);
    if (acc.length === 0) return fn(null);
    if (single && acc.length === 1) return fn(null, acc[0]);
    fn(err, acc);
  });
}

function flatten(obj, acc) {
  if (obj.deps) obj.deps.forEach(function(dep) {
    flatten(dep, acc);
  });
  if (Array.isArray(obj.value)) return acc.splice.apply(acc, [0, 0].concat(obj.value));
  if (typeof obj.value !== 'undefined') acc.splice(0, 0, obj.value);
}

function getTree(name, deploy, fn, path, parent) {
  path = path || deploy.path;
  resolve(path, parent, deploy, function(err, obj) {
    if (err) return fn(err);
    var val = {
      value: obj[name]
    };

    var deps = obj.requires;
    if (!deps) return fn(null, val);
    if (typeof deps === 'string') deps = [deps];

    each(deps, function(dep, cb) {
      getTree(name, deploy, cb, dep, path);
    }, function(err, res) {
      if (err) return fn(err);
      val.deps = res;
      fn(null, val);
    });
  });
}

function getOverride(name, deploy, fn, path, parent) {
  path = path || deploy.path;
  resolve(path, parent, deploy, function(err, obj) {
    if (err) return fn(err);
    if (typeof obj[name] !== 'undefined') return fn(null, obj[name]);

    var deps = obj.requires;
    if (!deps) return fn(null);
    if (typeof deps === 'string') deps = [deps];

    each(deps, function(dep, cb) {
      getOverride(name, deploy, cb, dep, path);
    }, function(err, res) {
      if (err) return fn(err);
      var val;
      for (var i = res.length - 1; i >= 0; i--) {
        if (typeof res[i] === 'undefined') continue;
        val = res[i];
        break;
      }
      fn(null, val);
    });
  });
}

function resolve(path, parent, deploy, fn) {
  debug('resolving ' + path);
  var cache = deploy._cache[path];
  if (typeof cache === 'function') return cache(fn);
  if (typeof cache === 'object') return fn(null, cache);

  var listeners = [];
  deploy._cache[path] = function(cb) {
    listeners.push(cb);
  };

  function pass(i) {
    var resolver = deploy._resolvers[i];
    if (!resolver) {
      var err = new Error('Could not resolve ' + path);
      deploy._cache[path] = err;
      listeners.forEach(function(listener) {
        try { listener(err); } catch(e) {}
      });
      return fn(err);
    }

    try {
      if (resolver.length === 3) resolver(path, parent, handle);
      else resolver(path, handle);
    } catch (err) {
      pass(i + 1);
    }

    function handle(err, obj) {
      if (err) return pass(i + 1);
      if (typeof obj === 'string') obj = parse(obj, path);
      deploy._cache[path] = obj;
      listeners.forEach(function(listener) {
        try { listener(null, obj); } catch(e) {}
      });
      debug('resolved ' + path, obj);
      fn(null, obj);
    }
  }
  pass(0);
}

function parse(str, path) {
  debugParse('parsing ' + path, str);
  return yaml(str, {filename: path}) || {};
}

function buildEnv(env, types, app, envs, deploy, fn) {
  debug('building env vars', env, types, app, envs);
  var ENV = {};

  function pass(i) {
    if (i === envs.length) return fn(null, ENV);
    var path = envs[i];
    debug('pulling env', path);
    builder(path, env, types, app, function(err, locals) {
      if (err) return fn(err);
      merge(ENV, locals);
      pass(i + 1);
    });
  }
  pass(0);
}
