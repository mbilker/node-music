var express = require('express')
  , app = express()
  , stylus = require('stylus')
  , util = require('util')
  , path = require('path')
  , fs = require('fs')
  , config = require('../config.json')
  , Music = require('./music.js');

var dir = path.join(__dirname, '..');

var App = function() {
  this.path = config.path;
  this.httpRoot = config.httpRoot || '';
  Music.start();
}

App.prototype = {
  start: function() {
    var self = this;

    app.configure(function() {
      app.set('views', path.join(dir, 'views'));
      app.set('view engine', 'ejs');
      app.use(express.logger('dev'));
      app.use(express.bodyParser());
      app.use(express.methodOverride());
      app.use(function(req, res, next) {
        res.header('Server', 'MusicBackend v1 - mbilker');
        next();
      });
      app.use(app.router);
      app.use(stylus.middleware({ debug: true, src: path.join(dir, 'stylus'), dest: path.join(dir, 'public') }));
      app.use(express.static(path.join(dir, 'public')));
    });

    app.enable('trust proxy');
    app.listen(5000);

    app.get('/', function(req, res) {
      res.render('index.ejs', {
        base: self.httpRoot
      });
    });

    var music = Music.routes;
    app.get('/list', music.list);
    app.get('/:artist/:album/:title', music.check);
    app.get('/get', music.get);
    app.get('/art', music.albumArt);
  }
}

module.exports = new App();
