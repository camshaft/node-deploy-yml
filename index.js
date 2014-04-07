/**
 * Module dependencies
 */

var debug = require('debug')('deploy-yml');
var debugParse = require('debug')('deploy-yml:parser');
var Batch = require('batch');
var yaml = require('js-yaml').safeLoad;

exports = module.exports = Deploy;

function Deploy(path) {
  if (!(this instanceof Deploy)) return new Deploy(path);
  this.path = path;
  this._resolvers = [];
  this._cache = {};
}

Deploy.prototype.use = function(fn) {
  this._resolvers.push(fn);
  return this;
};

Deploy.prototype.fetch = function(arr, fn) {
  var self = this;
  var batch = new Batch();

  arr.forEach(function(key) {
    batch.push(function(fn) {
      self[key](fn);
    });
  });

  batch.end(fn);
  return this;
};

// concat
Deploy.prototype.buildpacks = function(fn) {
  this.all('buildpacks', fn, true);
};

// concat
Deploy.prototype.resources = function(fn) {
  this.all('drain', fn);
};

// concat
Deploy.prototype.collaborators = function(fn) {
  this.all('collaborators', fn);
};

// concat
Deploy.prototype.drain = function(fn) {
  this.all('drain', fn);
};

// concat
Deploy.prototype.types = function(fn) {
  this.all('types', fn);
};

// concat
Deploy.prototype.regions = function(fn) {
  this.all('regions', fn);
};

// concat
Deploy.prototype.labs = function(fn) {
  this.all('labs', fn);
};

// override or concat
Deploy.prototype.env = function(env, fn) {
  if (typeof env === 'function') {
    fn = env;
    env = this.defaultEnv || 'prod';
  }
  this.fetch(['app', 'types'], function(err, res) {
    if (err) return fn(err);
    var app = res[0];
    var types = res[1];
    // TODO use env-builder-cli

    fn(null, {});
  });
};

// override
Deploy.prototype.app = function(fn) {
  this.first('error-pages', fn);
};

// override
Deploy.prototype.domains = function(fn) {
  this.first('error-pages', fn);
};

// override
Deploy.prototype.errorPages = function(fn) {
  this.first('error-pages', fn);
};

// generic functions

Deploy.prototype.first = function(name, fn) {
  getOverride(name, this, fn);
};

Deploy.prototype.all = function(name, fn, single) {
  getAll(name, this, fn, single);
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
  if (Array.isArray(obj.value)) acc.push.apply(acc, obj.value);
  if (typeof obj.value !== 'undefined') acc.push(obj.value);
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

    var batch = new Batch();

    deps.forEach(function(dep) {
      batch.push(function(cb) {
        getTree(name, deploy, cb, dep, path);
      });
    });

    batch.end(function(err, res) {
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

    var batch = new Batch();

    deps.forEach(function(dep) {
      batch.push(function(cb) {
        getOverride(name, deploy, cb, dep, path);
      });
    });

    batch.end(function(err, res) {
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
      delete deploy._cache[path];
      return fn(new Error('Could not resolve ' + path));
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
      listeners.forEach(function(listener) {
        try { listener(null, obj); } catch(e) {}
      });
      deploy._cache[path] = obj;
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
