/* I was using this to performance test my own server */
/* I installed the 'irc' library with npm */

var irc = require('irc'),
    host = 'localhost',
    Faker = require('Faker'),
    channel = '#test',
    client;

client = new irc.Client(host, 'bot', {
  channels: [channel],
  port: '6667',
  debug: true
});

client.addListener('message', function(from, to, message) {
  console.log(message);
  if (message.match(/part/)) {
    client.part(channel);
  }
});

(function speak() {
  client.say(channel, Faker.Lorem.sentence());
  setTimeout(speak, Math.round((Math.random() * 100)))
})();
