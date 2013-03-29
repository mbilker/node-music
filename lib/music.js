var express = require('express')
  , app = express()
  , probe = require('node-ffprobe')
  , Ratio = require('lb-ratio')
  , clc = require('cli-color')
  , async = require('async')
  , config = require('../config.json')
  , util = require('util')
  , path = require('path')
  , fs = require('fs')
  , EventEmitter = require('events').EventEmitter;

var dir = path.resolve(__dirname, '..');

var Music = function() {
  var self = this;
  self.path = config.path;
  self.songs = {};
  self.emitter = new EventEmitter();
  self.used = 0;
  self.counter = 0;
  fs.readFile(dir + '/bandwidth', 'utf8', function(err, data) {
    if (!err) self.used = parseInt(data);
    else console.log(err);
  });
}

Music.prototype.start = function() {
  app.configure(function() {
    app.use(express.logger('dev'));
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(function(req, res, next) {
      res.header('Server', 'MusicBackend v1 - mbilker');
      next();
    });
    app.use(app.router);
    app.use(express.static(path.join(dir, 'public')));
  });

  app.enable('trust proxy');
  app.listen(5000);

  var self = this;
  var status = clc.blue.bold('[*] ');
  var good = clc.green.bold('[+] ');

  function log() {
    var msg = util.format.apply(this, arguments) + '\n';
    self.emitter.emit('log', msg);
    //process.stdout.write(msg);
  }

  function saveCache() {
    fs.writeFile(path.resolve(dir, config.cache), JSON.stringify(self.songs));
  }

  function scanFile(path, file, artist, album, disk) {
    var tartist = artist, talbum = album, tdisk = disk;
    log(status + 'Scanning %s', file);
    self.counter += 1;
    probe(path + '/' + file, function(err, probeData) {
      //log(probeData);
      if (tartist == null) tartist = probeData.metadata.artist;
      if (talbum == null) talbum = probeData.metadata.album;
      if (tdisk == null) tdisk = parseInt((probeData.metadata.disk != null) ? probeData.metadata.disk : 1);
      var data = { 
        dir: path, 
        file: file, 
        metadata: { 
          title: (probeData.metadata.title != null) ? probeData.metadata.title : probeData.filename,
          artist: tartist,
          album: talbum,
          disk: tdisk,
          number: (probeData.metadata.track != null) ? Ratio.parse(probeData.metadata.track).numerator : 1
        }
      };
      //log(data);
      if (self.songs[tartist] == null) self.songs[tartist] = {};
      if (self.songs[tartist][talbum] == null) self.songs[tartist][talbum] = [];
      //log(util.inspect(songs));
      self.songs[tartist][talbum].push(data);
      self.counter -= 1;
      if (self.counter == 0) {
        saveCache();
      }
    });
  }
  
  function scanDir(path, artist, album, disk) {
    var files = fs.readdirSync(path);
    files.forEach(function(file) {
      var tartist = artist, talbum = album, tdisk = disk;
      fs.statSync(util.format('%s/%s', path, file), function(err, stat) {
        if (err) {
          console.log(err);
        } else if (stat.isFile()) {
          scanFile(path, file, artist, album, disk);
        } else if (stat.isDirectory()) {
          log('Found directory %s', file);
          if (artist != null) {
            log(status + 'Artist already set %s', artist);
            if (album != null) {
              log(status + 'Album already set %s', album);
              if (disk != null) {
                log(status + 'Disk already set %s', disk);
              } else {
                tdisk = parseInt(file);
                log(good + 'Disk set %s', tdisk);
              }
            } else {
              talbum = file;
              log(good + 'Album set %s', talbum);
            }
          } else {
            tartist = file;
            log(good + 'Artist set %s', tartist);
          }
          scanDir(util.format('%s/%s', path, file), tartist, talbum, tdisk);
        }
      });
    });
  }
  
  function scan() {
    self.songs = {};
    async.series([
      function(next) {
        log(clc.bold('--- Scanning Directories ---'));
        scanDir(self.path);
        log(clc.bold('--- Finished Scanning ---'));
      }
    ]);
  }
  
  function songEquals(song, artist, title) {
    //log({ song: song.metadata, artist: artist, title: title, artistTrue: (song.metadata.artist == artist), titleTrue: (song.metadata.title == title) });
    if ((song.metadata.artist == artist) && (song.metadata.title == title)) return true;
    return false;
  }

  app.get('/musicm/2/list', function(req, res) {
    log(status + util.format('%s - GET /musicm/2/list ', req.ip));
    res.setHeader('Content-Type', 'text/plain');
    var temp = [];
    for (i in self.songs) {
      var artist = { artist: i, albums: [] };
      temp.push(artist);
      var length = temp.length - 1;
      for (ii in self.songs[i]) {
        var album = { album: ii, tracks: [] };
        artist.albums.push(album);
        for (iii in self.songs[i][ii]) {
          album.tracks.push(self.songs[i][ii][iii].metadata);
        }
      }
    }
    res.end(JSON.stringify(temp));
  });
  
  app.get('/musicm/:artist/:album/:title', function(req, res) {
    res.setHeader('Content-Type', 'text/plain');
    var artist = req.params.artist, album = req.params.album, title = req.params.title;
    log(util.format('artist: %s, album: %s, title: %s\n', artist, album, title));
    for (i in self.songs[artist][album]) {
      var song = self.songs[artist][album][i];
      if (!self.songEquals(song, artist, title)) continue;
      res.end('true');
      return
    }
    res.end('false');
  });
  
  app.get('/musicm/get', function(req, res) {
    var song, spath;
    var artist = req.query.artist, album = req.query.album, title = req.query.title;
    log(status + util.format('%s - GET /musicm/get - %s, %s, %s ', req.ip, artist, album, title));
    for (i in self.songs[artist][album]) {
      song = self.songs[artist][album][i];
      if (self.songEquals(song, artist, title)) break;
    }
    spath = path.resolve(song.dir, song.file);
    if (!self.songEquals(song, artist, title)) {
      res.end('Not Found');
      return;
    }
    fs.stat(spath, function(err, stats) {
      if (err) {
        res.writeHead(500);
        res.end('There was an error getting the size of the file.');
        return;
      } else if (!req.header('Range')) {
        res.writeHead(200, {
          'Connection': 'close', 
          'Content-Type': 'audio/mpeg',
          'Content-Length': stats.size
        });
        fs.createReadStream(spath).pipe(res);
      } else {
        var start = 0;
        var end = 0;
        var range = req.header('Range');
        if (range != null) {
          start = parseInt(range.slice(range.indexOf('bytes=') + 6, range.indexOf('-')));
          end = parseInt(range.slice(range.indexOf('-') + 1, range.length));
        }
        if (isNaN(end) || end == 0) end = stats.size - 1;
        if (start > end) return;
        //log(good + 'Browser requested bytes from ' + start + ' to ' + end + ' of file ' + spath);

        res.writeHead(206, { 
          'Connection': 'close', 
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stats.size, 
          'Content-Type': 'audio/mpeg', 
          'Content-Length': end - start,  
          'Transfer-Encoding': 'chunked'
        });
        var read = fs.createReadStream(spath, { flags: 'r', start: start, end: end });
        read.pipe(res);
        self.storeUsed(stats.size);
      }
    });
  });

  app.get('/musicm/bandwidth', function(req, res) {
    res.end('' + self.used);
  });

  self.bandwidthUsed = function() {
    return Math.round((self.used/1024/1024)*100)/100;
  }
  
  function storeUsed(amount) {
    self.used += amount;
    fs.writeFileSync(dir + '/bandwidth', self.used, 'utf8');
  }

  self.eval = function(cmd, context, filename, callback) {
    var err, result;
    try {
      result = eval(cmd);
    } catch(e) {
      err = e;
    }
    callback(err, result);
  }

  self.log = log;
  self.saveCache = saveCache;
  self.scanFile = scanFile;
  self.scanDir = scanDir;
  self.scan = scan;
  self.songEquals = songEquals;
  self.storeUsed = storeUsed;

  self.scan();
}

module.exports = Music;
