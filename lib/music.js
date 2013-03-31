var probe = require('node-ffprobe')
  , Ratio = require('lb-ratio')
  , clc = require('cli-color')
  , config = require('../config.json')
  , util = require('util')
  , path = require('path')
  , fs = require('fs')
  , EventEmitter = require('events').EventEmitter
  , LastFmNode = require('lastfm').LastFmNode;

var dir = path.join(__dirname, '..');

var Music = function() {
  var self = this;
  self.path = config.path;
  self.songs = {};
  self.events = new EventEmitter();
  self.used = 0;
  self.counter = 0;
  self.loopFinished = false;
  self.cache = (fs.existsSync(path.join(dir, config.cache)) ? require(path.join(dir, config.cache)) : {});
  self.lastfm = new LastFmNode({
    api_key: config.lastfm.api_key,
    secret: config.lastfm.secret
  });
}

Music.prototype.start = function() {
  var self = this;
  var events = self.events;

  var status = clc.blue.bold('[*] ');
  var good = clc.green.bold('[+] ');

  function log() {
    var msg = util.format.apply(this, arguments) + '\n';
    fs.appendFileSync(path.join(dir, 'app.log'), msg);
  }

  function print() {
    log(arguments);
    console.log(util.format.apply(this, arguments));
  }

  function saveCache() {
    var files = {};
    for (i in self.songs) {
      for (ii in self.songs[i]) {
        for (iii in self.songs[i][ii]) {
          var song = self.songs[i][ii][iii];
          files[song.dir] = files[song.dir] || {};
          files[song.dir][song.file] = song.metadata;
        }
      }
    }
    fs.writeFile(path.join(dir, config.cache), JSON.stringify(files));
  }

  function addSong(path, file, song) {
    var data = {
      dir: path,
      file: file,
      metadata: song
    }
    var artist = song.artist, album = song.album;
    self.songs[artist] = self.songs[artist] || {};
    self.songs[artist][album] = self.songs[artist][album] || [];
    self.songs[artist][album].push(data);
    self.counter -= 1;
  }

  function scanFile(rpath, file, artist, album, disk) {
    var tartist = artist, talbum = album, tdisk = disk;
    log(status + 'Scanning %s', file);
    if (self.cache[rpath] && self.cache[rpath][file]) {
      var song = self.cache[rpath][file];
      addSong(rpath, file, song);
    } else {
      probe(path.join(rpath, file), function(err, data) {
        if (err) {
          console.log(err);
          return;
        }
        var meta = data.metadata;
        var song = {
          title: meta.title || data.filename,
          artist: tartist || meta.artist,
          album: talbum || meta.album,
          disk: tdisk || parseInt(meta.disk || 1),
          number: Ratio.parse(meta.track).numerator || 1
        };
        addSong(rpath, file, song);
      });
    }
  }
  
  function scanDir(rpath, main, artist, album, disk) {
    main = (main || false);
    var files = fs.readdirSync(rpath);
    files.forEach(function(file) {
      var tartist = artist, talbum = album, tdisk = disk;
      var stat = fs.statSync(path.join(rpath, file));
      if (stat.isFile()) {
        self.counter += 1;
        scanFile(rpath, file, artist, album, disk);
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
        scanDir(path.join(rpath, file), false, tartist, talbum, tdisk);
      }
      if (main)
        self.loopFinished = true;
    });
  }
  
  function scan() {
    self.songs = {};
    print(clc.bold('--- Scanning Directories ---'));
    events.on('finished', function() {
      print(clc.bold('--- Finished Scanning ---'));
      saveCache();
    });

    function checkFinished() {
      setImmediate(function() {
        if (self.counter == 0 && self.loopFinished) {
          events.emit('finished');
        } else {
          checkFinished();
        }
      });
    }
    checkFinished();

    scanDir(self.path, true);
  }
  
  function songEquals(song, artist, title) {
    //log({ song: song.metadata, artist: artist, title: title, artistTrue: (song.metadata.artist == artist), titleTrue: (song.metadata.title == title) });
    if ((song.metadata.artist == artist) && (song.metadata.title == title)) return true;
    return false;
  }

  var routes = {
    list: function(req, res) {
      log(status + util.format('%s - GET /list ', req.ip));
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
    },
    check: function(req, res) {
      res.setHeader('Content-Type', 'text/plain');
      var artist = req.params.artist, album = req.params.album, title = req.params.title;
      log(util.format('artist: %s, album: %s, title: %s\n', artist, album, title));
      for (i in self.songs[artist][album]) {
        var song = self.songs[artist][album][i];
        if (!self.songEquals(song, artist, title)) continue;
        res.end('true');
        return;
      }
      res.end('false');
    },
    get: function(req, res) {
      var song, spath;
      var artist = req.query.artist, album = req.query.album, title = req.query.title;
      log(status + util.format('%s - GET /get - %s, %s, %s ', req.ip, artist, album, title));
      for (i in self.songs[artist][album]) {
        song = self.songs[artist][album][i];
        if (self.songEquals(song, artist, title)) break;
      }
      spath = path.join(song.dir, song.file);
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
        }
      });
    },
    albumArt: function(req, res) {
      if ((config.lastfm.api_key == '') || (config.lastfm.secret == '')) {
        res.end(config.httpRoot + 'img/noAlbumArt.png');
        return;
      }

      var artist = req.query.artist, album = req.query.album;
      if (!artist || !album) {
        res.writeHead(500);
        res.end('You did not supply a artist or album');
        return;
      }
      self.lastfm.request('album.getInfo', {
        artist: artist,
        album: album,
        handlers: {
          success: function(data) {
            //res.end(JSON.stringify(data));
            res.end(data.album.image[2]['#text']);
          },
          error: function(err) {
            res.end(config.httpRoot + 'img/noAlbumArt.png');
          }
        }
      });
    }
  }

  self.log = log;
  self.print = print;
  self.saveCache = saveCache;
  self.scanFile = scanFile;
  self.scanDir = scanDir;
  self.scan = scan;
  self.songEquals = songEquals;

  self.routes = routes;

  self.scan();
}

module.exports = new Music();
