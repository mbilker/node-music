#!/usr/local/bin/node

var probe = require('node-ffprobe')
  , Ratio = require('lb-ratio')
  , express = require('express')
  , app = express()
  , clc = require('cli-color')
  , util = require('util')
  , fs = require('fs');

// nginx user
process.setgid(107);
process.setuid(105);

var path = '/srv/www/mbilker.us/public_html/music/archive';

var songs = {};

var status = clc.blue.bold('[*] ');
var good = clc.green.bold('[+] ');

function checkForSongs(cb) {
  if (songs.length == 0) {
    process.nextTick(function() { checkForSongs(cb) });
  } else {
    cb();
  }
}

function scanFile(path, file, artist, album, disk) {
  var tartist = artist, talbum = album, tdisk = disk;
  console.log(status + 'Scanning %s', file);
  probe(path + '/' + file, function(err, probeData) {
    //console.log(probeData);
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
    //console.log(data);
    if (songs[tartist] == null) songs[tartist] = {};
    if (songs[tartist][talbum] == null) songs[tartist][talbum] = [];
    //console.log(util.inspect(songs));
    songs[tartist][talbum].push(data);
  });
}

function scanDir(path, artist, album, disk) {
  var files = fs.readdirSync(path);
  files.forEach(function(file) {
    var tartist = artist, talbum = album, tdisk = disk;
    var stat = fs.statSync(util.format('%s/%s', path, file));
    if (stat.isFile()) {
      scanFile(path, file, artist, album, disk);
    } else if (stat.isDirectory()) {
      console.log('Found directory %s', file);
      if (artist != null) {
        console.log(status + 'Artist already set %s', artist);
        if (album != null) {
          console.log(status + 'Album already set %s', album);
          if (disk != null) {
            console.log(status + 'Disk already set %s', disk);
          } else {
            tdisk = parseInt(file);
            console.log(good + 'Disk set %s', tdisk);
          }
        } else {
          talbum = file;
          console.log(good + 'Album set %s', talbum);
        }
      } else {
        tartist = file;
        console.log(good + 'Artist set %s', tartist);
      }
      scanDir(util.format('%s/%s', path, file), tartist, talbum, tdisk);
    }
  });
}

function scan() {
  songs = {};
  console.log(clc.bold('--- Scanning Directories ---'));
  scanDir(path);
  console.log(clc.bold('--- Finished Scanning ---'));
  checkForSongs(function() {
    //console.log(songs);
  });
}

function songEquals(song, artist, title) {
  //console.log({ song: song.metadata, artist: artist, title: title, artistTrue: (song.metadata.artist == artist), titleTrue: (song.metadata.title == title) });
  if ((song.metadata.artist == artist) && (song.metadata.title == title)) return true;
  return false;
}

app.get('/musicm/list', function(req, res) {
  console.log(status + util.format('%s - GET /musicm/list ', req.ip));
  res.setHeader('Content-Type', 'text/plain');
  var temp = {};
  for (i in songs) {
    temp[i] = {};
    for (ii in songs[i]) {
      temp[i][ii] = [];
      for (iii in songs[i][ii]) {
        temp[i][ii][iii] = songs[i][ii][iii].metadata;
      }
    }
  }
  //console.log(util.inspect(temp));
  res.end(JSON.stringify(temp));
});

app.get('/musicm/2/list', function(req, res) {
  console.log(status + util.format('%s - GET /musicm/2/list ', req.ip));
  res.setHeader('Content-Type', 'text/plain');
  var temp = [];
  for (i in songs) {
    var artist = { artist: i, albums: [] };
    temp.push(artist);
    var length = temp.length - 1;
    for (ii in songs[i]) {
      var album = { album: ii, tracks: [] };
      artist.albums.push(album);
      for (iii in songs[i][ii]) {
        album.tracks.push(songs[i][ii][iii].metadata);
      }
    }
  }
  //console.log(util.inspect(temp, false, null, true));
  res.end(JSON.stringify(temp));
});

app.get('/musicm/:artist/:album/:title', function(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  var artist = req.params.artist, album = req.params.album, title = req.params.title;
  console.log(util.format('artist: %s, album: %s, title: %s\n', artist, album, title));
  for (i in songs[artist][album]) {
    var song = songs[artist][album][i];
    if (!songEquals(song, artist, title)) continue;
    res.end('true');
    return
  }
  res.end('false');
});

app.get('/musicm/:artist/:album/:title/get', function(req, res) {
  var song;
  var artist = req.params.artist, album = req.params.album, title = req.params.title;
  console.log(status + util.format('%s - GET /musicm/%s/%s/%s/get ', req.ip, artist, album, title));
  for (i in songs[artist][album]) {
    song = songs[artist][album][i];
    if (songEquals(song, artist, title)) break;
  }
  if (!songEquals(song, artist, title)) {
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

    //console.log('Browser requested bytes from ' + start + ' to ' + end + ' of file ' + song.path);

    res.writeHead(206, { 
      'Connection': 'close', 
      'Content-Range': 'bytes ' + start + '-' + end + '/' + stats.size, 
      'Content-Type': 'audio/mpeg', 
      'Content-Length': end - start,  
      'Transfer-Encoding': 'chunked'
    });
    var read = fs.createReadStream(song.path, { flags: 'r', start: start, end: end });
    read.pipe(res);
  });
  //fs.createReadStream(song.path).pipe(new lame.Decoder()).on('format', function(format) {
  //  console.error(format);
  //  var encoder = new lame.Encoder(encoderOptions);
  //  this.pipe(encoder).pipe(res);
  //});
});

app.enable('trust proxy');
app.listen(2555, 'localhost');

scan();
