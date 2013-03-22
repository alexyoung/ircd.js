var 
  winston = require('winston'),
  User = require('./user').User,
  io = null;



function AbstractConnection(stream) {
  this.stream = stream;
  this.object = null;
  

  this.__defineGetter__('id', function() {
    return this.object ? this.object.id : 'Unregistered';
  });
}

function Websocket(server,config) {
	this.server = server;
	
	io = require('socket.io').listen(config.port);
	this.start();
	
}

Websocket.prototype = {

  start: function () {

  		var self = this;
  				
	  	io.sockets.on('connection', function (socket) {  			  
			  
			  var client = new AbstractConnection(socket);
			  client.object = new User(client, self.server);
		     
			  client.object.useWebsocket = true;

			  socket.on('message', function (data) {
					self.server.respond(data, client);
			  });
			  
		});
  }

}


exports.Websocket = Websocket;
