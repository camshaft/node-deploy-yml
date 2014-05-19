/**
 * Module dependencies
 */

var should = require('should');
var deploy = require('..');
var read = require('fs').readFile;

function resolve(path, fn) {
  read(__dirname + '/resources/' + path, 'utf8', fn);
}

describe('deploy-yml', function() {
  var d;
  beforeEach(function() {
    d = deploy('index.yml');
    d.use(resolve);
  });

  var deps = [
    'index',
    'dep1',
    'dep1-1',
    'dep1-2',
    'dep2',
    'dep2-1',
    'dep2-2'
  ];

  describe('first', function() {
    deps.forEach(function(key) {
      it('should get "' + key + '"', function(done) {
        d.first(key, function(err, val) {
          if (err) return done(err);
          should.exist(val);
          val.should.eql(key);
          done();
        });
      });
    });
  });

  describe('all', function() {
    it('should merge all of the values for a key', function(done) {
      d.all('all', function(err, val) {
        if (err) return done(err);
        should.exist(val);
        val.should.eql(deps.reverse());
        done();
      });
    });
  });

  describe('env', function() {
    it('should resolve the env vars', function(done) {
      this.timeout(0);
      d.env('prod', function(err, env) {
        if (err) return done(err);
        should.exist(env);
        env.should.eql({
          '1': 'true',
          'ALL': 'index',
          'INDEX': 'true'
        });
        done();
      });
    });
  });
});
