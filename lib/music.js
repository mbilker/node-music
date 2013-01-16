var probe = require('node-ffprobe')
  , Ratio = require('lb-ratio')
  , clc = require('cli-color')
  , restify = require('restify')
  , util = require('util')
  , fs = require('fs')
  , EventEmitter = require('events').EventEmitter;

var Music = function() {
  this.path = '/d2/music/archive';
  this.songs = {};
  this.used = 0;
  this.emitter = new EventEmitter();
}

Music.prototype.start = function() {
  var server = restify.createServer({
    name: 'MusicBackend',
    version: '1.0.0'
  });
  server.use(restify.acceptParser(server.acceptable));
  server.use(restify.authorizationParser());
  server.use(restify.dateParser());
  server.use(restify.queryParser());
  server.use(restify.jsonp());
  server.use(restify.gzipResponse());
  server.use(restify.bodyParser());
  server.use(function(req, res, next) {
    res.header('X-Powered-By', 'MusicBackend v1 - mbilker');
    next();
  });

  // nobody
  process.setgid(99);
  process.setuid(99);

  var self = this;
  var status = clc.blue.bold('[*] ');
  var good = clc.green.bold('[+] ');

  self.log = log = function() {
    var msg = util.format.apply(this, arguments) + '\n';
    self.emitter.emit('log', msg);
    process.stdout.write(msg);
  }

  self.checkForSongs = function(cb) {
    if (songs.length == 0) {
      process.nextTick(function() { checkForSongs(cb) });
    } else {
      cb();
    }
  }

  self.scanFile = function(path, file, artist, album, disk) {
    var tartist = artist, talbum = album, tdisk = disk;
    log(status + 'Scanning %s', file);
    probe(path + '/' + file, function(err, probeData) {
      //log(probeData);
      if (tartist == null) tartist = probeData.metadata.artist;
      if (talbum == null) talbum = probeData.metadata.album;
      if (tdisk == null) tdisk = parseInt((probeData.metadata.disk != null) ? probeData.metadata.disk : 1);
      var data = { 
        path: util.format('%s/%s', path, file), 
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
    });
  }
  
  self.scanDir = function(path, artist, album, disk) {
    var files = fs.readdirSync(path);
    files.forEach(function(file) {
      var tartist = artist, talbum = album, tdisk = disk;
      var stat = fs.statSync(util.format('%s/%s', path, file));
      if (stat.isFile()) {
        self.scanFile(path, file, artist, album, disk);
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
        self.scanDir(util.format('%s/%s', path, file), tartist, talbum, tdisk);
      }
    });
  }
  
  self.scan = function() {
    self.songs = {};
    self.log(clc.bold('--- Scanning Directories ---'));
    self.scanDir(self.path);
    self.log(clc.bold('--- Finished Scanning ---'));
    //checkForSongs(function() {
    //  log(songs);
    //});
  }
  
  self.songEquals = function(song, artist, title) {
    //log({ song: song.metadata, artist: artist, title: title, artistTrue: (song.metadata.artist == artist), titleTrue: (song.metadata.title == title) });
    if ((song.metadata.artist == artist) && (song.metadata.title == title)) return true;
    return false;
  }

/*  
  server.get('/musicm/list', function(req, res) {
    log(status + util.format('%s - GET /musicm/list ', req.ip));
    res.setHeader('Content-Type', 'text/plain');
    var temp = {};
    for (i in self.songs) {
      temp[i] = {};
      for (ii in self.songs[i]) {
        temp[i][ii] = [];
        for (iii in self.songs[i][ii]) {
          temp[i][ii][iii] = self.songs[i][ii][iii].metadata;
        }
      }
    }
    //log(util.inspect(temp));
    res.end(JSON.stringify(temp));
  });
*/

  server.get('/musicm/2/list', function(req, res) {
    log(status + util.format('%s - GET /musicm/2/list ', req.header('x-forwarded-for')));
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
    //log(util.inspect(temp, false, null, true));
    res.end(JSON.stringify(temp));
  });
  
  server.get('/musicm/:artist/:album/:title', function(req, res) {
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
  
  server.get('/musicm/get', function(req, res) {
    var song;
    var artist = req.params.artist, album = req.params.album, title = req.params.title;
    log(status + util.format('%s - GET /musicm/get - %s, %s, %s ', req.header('x-forwarded-for'), artist, album, title));
    for (i in self.songs[artist][album]) {
      song = self.songs[artist][album][i];
      if (self.songEquals(song, artist, title)) break;
    }
    if (!self.songEquals(song, artist, title)) {
      res.end('Not Found');
      return;
    }
    fs.stat(song.path, function(err, stats) {
      if (err) {
        res.writeHead(500);
        return;
      }
      var start = 0;
      var end = 0;
      var range = req.header('Range');
      if (range != null) {
        start = parseInt(range.slice(range.indexOf('bytes=') + 6, range.indexOf('-')));
        end = parseInt(range.slice(range.indexOf('-') + 1, range.length));
      }
      if (isNaN(end) || end == 0) end = stats.size - 1;
      if (start > end) return;

      //log(good + 'Browser requested bytes from ' + start + ' to ' + end + ' of file ' + song.path);

      res.writeHead(206, { 
        'Connection': 'close', 
        'Content-Range': 'bytes ' + start + '-' + end + '/' + stats.size, 
        'Content-Type': 'audio/mpeg', 
        'Content-Length': end - start,  
        'Transfer-Encoding': 'chunked'
      });
      var read = fs.createReadStream(song.path, { flags: 'r', start: start, end: end });
      read.pipe(res);
      self.used += stats.size;
      res.on('close', function() {
        log('closed');
        self.used -= stats.size;
        self.used += res.socket.bytesWritten;
      });
    });
  });

  self.bandwidthUsed = function() {
    return Math.round((self.used/1024/1024)*100)/100;
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

  //server.listen(2555, 'localhost');
  server.listen(2555);
  
  self.scan();
}

module.exports = Music;
