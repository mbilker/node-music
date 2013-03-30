#!/usr/bin/env node

var Music = require('./lib/music');

var music = new Music();

process.nextTick(function() {
  music.start();
});

var inMusicContext = false;
var origEval;
function eval(cmd, context, filename, callback) {
  if (inMusicContext) {
    music.eval(cmd, context, filename, callback);
  } else {
    origEval(cmd, context, filename, callback);
  }
}

var notInContext = 'music::remote> ';
var inContext = 'music::remote::context> ';

require('net').createServer(function(socket) {
  var r = require('repl').start({
    prompt: (inMusicContext ? inContext : notInContext),
    input: socket,
    output: socket,
    terminal: true,
    useGlobal: false
  });
  var listener = function(msg) {
    socket.write('\u001b[1G' + msg + '\u001b[K');
    r.displayPrompt();
  }
  r.on('exit', function() {
    socket.end();
  });
  origEval = r.eval;
  r.eval = eval;
  r.defineCommand('music', {
    help: 'enter server context',
    action: function() {
      if (!inMusicContext) {
        inMusicContext = true;
        this.prompt = inContext;
        this.displayPrompt();
      } else {
        inMusicContext = false;
        this.prompt = notInContext;
        this.displayPrompt();
      }
    }
  });
  r.context.music = music;
  r.context.socket = socket;
}).listen(1337);
