var util = require('util');

var redis = require('redis');
var ical = require('ical');
var async = require('async');
var moment = require('moment');

var Calendar = function() {
  this.commands = ['cal', 'delcal'];
  this.auto = ['checkTimer'];
  this.unload = ['destroy'];
  this.usage = {
    cal: 'Get the current calendar for the channel. If you pass a URL, it will set the calendar for the channel.',
    upcoming: 'Print out the next event for the channel.'
  };

  this.interval = null;
};

Calendar.prototype.destroy = function(callback) {
  clearInterval(this.interval);
  callback();
}

Calendar.prototype.getCalendars = function(bot, callback) {
  var redisClient = redis.createClient(bot.redisConf.port, bot.redisConf.host);

  async.auto({
    channels: function(callback) {
      redisClient.smembers([bot.redisConf.prefix, 'calendars'].join(':'), function(err, results) {
        callback(null, results);
      });
    },
    urls: ['channels', function(callback, results) {
      var chans = results.channels,
          urls = {};

      async.forEach(chans, function(chan, callback) {
        redisClient.get([bot.redisConf.prefix, chan, 'calendar'].join(':'), function(err, result) {
          urls[chan] = result;
          callback();
        });
      }, function() {
        callback(null, urls);
      });
    }]
  }, function(err, results) {
    redisClient.quit();
    callback(err, results.urls);
  });
};

Calendar.prototype.getEvents = function(parsedCal) {
  var events = [];
  Object.keys(parsedCal).forEach(function(id) {
    var ev = parsedCal[id],
        now = new Date(),
        newEvent = null;

    if (ev.type === 'VEVENT') {
      if (ev.start > now) {
        newEvent = {
          title: ev.summary,
          starts: ev.start
        };
      } else if (ev.rrule && ev.rrule.after(now)) {
        newEvent = {
          title: ev.summary,
          starts: ev.rrule.after(now)
        };
      }

      if (newEvent) {
        events.push(newEvent);
      }
    }
  });

  return events;
};

Calendar.prototype.checkTimer = function(bot) {
  var self = this;

  this.interval = setInterval(function() {
    async.auto({
      calendars: function(callback) {
        self.getCalendars(bot, callback);
      },

      events: ['calendars', function(callback, results) {
        var cals = results.calendars,
            events = {};

        async.forEach(Object.keys(cals), function(chan, callback) {
          ical.fromURL(cals[chan], {}, function(err, data) {
            if (err) {
              events[chan] = [];
              callback();
              return;
            }
            events[chan] = self.getEvents(data);
            callback();
          });
        }, function() {
          callback(null, events);
        });
      }],

      notify: ['events', function(callback, results) {
        var events = results.events,
            now = new Date().getTime();

        Object.keys(events).forEach(function(chan) {
          var chanEvents = events[chan];

          chanEvents.forEach(function(ev) {
            var m = moment(ev.starts),
                now = Date.now(),
                starTime = ev.starts.getTime(0);

            bot.say(chan, util.format('%s starts in %s (%s)',
              ev.title, m.fromNow(), m.format('MMMM Do YYYY, h:mm a Z')));
          })
        });
      }]
    }, function(err, results) {

    });
  }, 10000);
};

Calendar.prototype.cal = function(bot, to, from, msg, callback) {
  var redisClient = redis.createClient(bot.redisConf.port, bot.redisConf.host),
      calKey = [bot.redisConf.prefix, to, 'calendar'].join(':');

  if (msg) {
    async.series([
      function(callback) {
        redisClient.set(calKey, msg, callback);
      },

      function(callback) {
        redisClient.sadd([bot.redisConf.prefix, 'calendars'].join(':'), to, callback)
      }
    ], function(err) {
      callback(err);
      redisClient.quit();
    });
  } else {
    redisClient.get(calKey, function(err, results) {
      if (results) {
        bot.say(to, util.format('The calendar URL for %s is %s', to, results));
      } else {
        bot.say(to, util.format('No calendar set for %s', to));
      }
      callback(err);
      redisClient.quit();
    });
  }
};

Calendar.prototype.upcoming = function(bot, to, from, msg, callback) {
  bot.say(to, 'upcoming function');
  callback();
};

Calendar.prototype.delcal = function(bot, to, from, msg, callback) {
  var redisClient = redis.createClient(bot.redisConf.port, bot.redisConf.host);
  async.series([
    function(callback) {
      redisClient.srem([bot.redisConf.prefix, 'calendars'].join(':'), to, callback)
    },
    function(callback) {
      redisClient.del([bot.redisConf.prefix, to, 'calendar'].join(':'), callback)
    }
  ], function() {
    redisClient.quit();
    bot.say(to, util.format('Calendar successfully removed for %s.', to));
    callback();
  });
};

exports.Plugin = Calendar;