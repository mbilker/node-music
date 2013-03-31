var audio, songplaying, list, listView;

$(document).ready(function() {
  audio = $('#audio');
  songplaying = $('#song');
  list = $('#songs');

  _.templateSettings = {
    interpolate: /\{\{(.+?)\}\}/g
  };

  function songPlay(track) {
    if (track == null) return;
    $('.playing').removeClass('playing');
    var player = audio[0]
      , artist = encodeURIComponent(track.get('artist'))
      , album = encodeURIComponent(track.get('album'))
      , title = encodeURIComponent(track.get('title'));
    $('#oggsource').attr('src', base + 'get?artist=' + artist + '&album=' + album + '&title=' + title).detach().appendTo("#audio");
    $.ajax({
      type: 'GET',
      url: base + 'art',
      data: {
        artist: track.get('artist'),
        album: track.get('album')
      }
    }).done(function(data) {
      $('#albumArt').attr('src', data);
    });
    player.track = track;
    player.trackView = track.get('view').$el;
    player.trackView.addClass('playing');
    if (!player.paused)
      player.pause();
    player.load();
    player.play();
    songplaying.html(track.get('artist') + ' - ' + track.get('album') + ' - ' + track.get('title'));
  }

  audio.on('ended', function(ev) {
    var collection = audio[0].track.collection;
    var track = collection.at(collection.indexOf(audio[0].track) + 1);
    songPlay(track);
  });

  $('#prev').on('click', function(ev) {
    ev.preventDefault();
    var collection = audio[0].track.collection;
    var track = collection.at(collection.indexOf(audio[0].track) - 1);
    songPlay(track);
    return false;
  });

  $('#next').on('click', function(ev) {
    ev.preventDefault();
    var collection = audio[0].track.collection;
    var track = collection.at(collection.indexOf(audio[0].track) + 1);
    songPlay(track);
    return false;
  });

  var Track = Backbone.Model.extend({
    defaults: {
      artist: '',
      album: '',
      title: '',
      disk: 0,
      number: 0
    }
  });

  var TrackList = Backbone.Collection.extend({
    model: Track
  });

  var Album = Backbone.Model.extend({
    defaults: {
      album: '',
      artist: '',
      tracks: []
    }
  });

  var AlbumList = Backbone.Collection.extend({
    model: Artist
  });

  var Artist = Backbone.Model.extend({});

  var ArtistList = Backbone.Collection.extend({
    model: Artist,
    url: base + 'list'
  });

  var SongView = Backbone.View.extend({
    tagName: 'li',
    template: _.template($('#song-template').html()),
    events: {
      "click .play": "play"
    },
    initialize: function() {
      _.bindAll(this, 'render', 'play');
    },
    render: function() {
      var self = this;
      this.$el.html(this.template(this.model.toJSON()));
      return this;
    },
    play: function(ev) {
      songPlay(this.model);
      ev.preventDefault();
      return false;
    }
  });

  var AlbumView = Backbone.View.extend({
    tagName: 'li',
    template: _.template($('#album-template').html()),
    events: {
      "click .album": "click"
    },
    initialize: function() {
      _.bindAll(this, 'render', 'addTrack', 'appendTrack', 'click');
      this.collection = new TrackList();
      //this.collection.bind('add', this.appendTrack);
      this.collection.comparator = function(track) {
        return track.get('number') + (track.get('disk') * 100);
      }

      _.each(this.model.get('tracks'), function(track) {
        this.addTrack(track);
      }, this);
    },
    render: function() {
      this.$el.html(this.template(this.model.toJSON()));
      this.collection.each(function(track) {
        this.appendTrack(track);
      }, this);
      return this;
    },
    addTrack: function(track) {
      var newTrack = new Track();
      newTrack.set({
        artist: this.model.get('artist'),
        album: this.model.get('album'),
        title: track.title,
        disk: track.disk,
        number: track.number
      });
      this.collection.add(newTrack);
    },
    appendTrack: function(track) {
      var songView = new SongView({ model: track, album: this });
      this.$el.children('.tracks').append(songView.render().el);
      track.set('view', songView);
    },
    click: function() {
      this.$el.children('.tracks').toggleClass('show').animate({ height: 'toggle' }, 'fast');
    }
  });

  var ArtistView = Backbone.View.extend({
    tagName: 'li',
    template: _.template($('#artist-template').html()),
    events: {
      "click .artist": "click"
    },
    initialize: function() {
      _.bindAll(this, 'render', 'addAlbum', 'appendAlbum', 'click');
      this.collection = new AlbumList();
      this.collection.comparator = function(album) {
        return album.get('album');
      }
      //this.collection.bind('add', this.appendAlbum);

      _.each(this.model.get('albums'), function(album) {
        this.addAlbum(album);
      }, this);
    },
    render: function() {
      this.$el.html(this.template(this.model.toJSON()));
      this.collection.sort();
      this.collection.each(function(album) {
        this.appendAlbum(album);
      }, this);
      return this;
    },
    addAlbum: function(album) {
      var newAlbum = new Album();
      newAlbum.set({
        album: album.album,
        artist: this.model.get('artist'),
        tracks: album.tracks
      });
      this.collection.add(newAlbum);
    },
    appendAlbum: function(album) {
      var albumView = new AlbumView({ model: album, artist: this });
      this.$el.children('.albums').append(albumView.render().el);
      album.set('view', albumView);
    },
    click: function() {
      var albums = this.$el.children('.albums');
      albums.animate({ height: 'toggle' }, 'fast');
      $('.show', albums).removeClass('show').animate({ height: 'toggle' }, 'fast');
    }
  });

  var ListView = Backbone.View.extend({
    el: $('#songs'),
    initialize: function() {
      _.bindAll(this, 'render', 'appendArtist');

      this.collection = new ArtistList();
      this.collection.comparator = function(artist) {
        return artist.get('artist');
      }
      this.collection.bind('add', this.appendArtist);
      this.collection.bind('reset', function() { this.collection.sort(); this.render() }, this);
      this.collection.fetch();
    },
    render: function() {
      _(this.collection.models).each(function(item) {
        this.appendArtist(item);
      }, this);
    },
    appendArtist: function(item) {
      //console.log(item);
      var artistView = new ArtistView({ model: item });
      $(this.el).append(artistView.render().el);
      item.set('view', artistView);
    }
  });
  listView = new ListView();
});
