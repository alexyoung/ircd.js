exports.reply = {
  welcome:          '001',
  yourHost:         '002',
  created:          '003',
  myInfo:           '004',

  away:             '301',
  unaway:           '305',
  nowAway:          '306',
  whoIsUser:        '311',
  whoIsServer:      '312',
  whoIsOperator:    '313',
  whoWasUser:       '314',
  whoIsIdle:        '317',
  endOfWhoIs:       '318',
  whoIsChannels:    '319',

  topic:            '332',
  noTopic:          '331',
  inviting:         '341',
  nameReply:        '353',
  endNames:         '366',
  endWhoWas:        '369',

  listStart:        '321',
  list:             '322',
  listEnd:          '323',

  version:          '351',

  motdStart:        '375',
  motd:             '372',
  motdEnd:          '376',
  who:              '352',
  endWho:           '315',
  channelModes:     '324',
  banList:          '367',
  endBan:           '368',

  youAreOper:       '381',

  time:             '391'
};

exports.errors = {
  // Errors
  noSuchNick:       '401',
  noSuchServer:     '402',
  cannotSend:       '404',
  wasNoSuchNick:    '406',
  noRecipient:      '411',
  noTextToSend:     '412',
  noNickGiven:      '431',
  badNick:          '432',
  nameInUse:        '433',
  userNotInChannel: '441',
  userOnChannel:    '443',
  noSuchChannel:    '403',
  notOnChannel:     '442',
  needMoreParams:   '461',
  passwordWrong:    '464',
  youAreBanned:     '465',
  keySet:           '467',
  channelIsFull:    '471',
  inviteOnly:       '473',
  banned:           '474',
  badChannelKey:    '475',
  noPrivileges:     '481',
  channelOpsReq:    '482',
  noOperHost:       '491',

  usersDoNotMatch:  '502'
};

exports.validations = {
  // starts with letter, than more letters, digits or -[]\`^{}
  invalidNick: /^[^a-z]|[^\w_^`\\\[\]{}]/i,
  
  // any 8bit code except NUL, BELL, LF, CR, SPACE and comma
  invalidChannel: /[\x00\x07\n\r ,]/,

  // any 7-bit US_ASCII character, except NUL, TAB, LF, VT, FF, CR, SPACE and comma
  invalidChannelKey: /[\x80-\uFFFF\x00\t\n\x0B\x0C\r ,]/
};
