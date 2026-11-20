const protocolRegex = /(?:https?:\/\/)/;
const wwwRegex = /(?:www\.)/;
const hostRegex = /[-a-z0-9@:%._+~#=]{1,256}/; // hostname / labels (len limited)
const tldRegex = /(?:com|org|net|gov|edu|co|info|biz|app|dev)/;
const ccTldRegex = /[a-z]{2}/; // country code TLD without leading dot (e.g. "br", "uk")
const portRegex = /(?::\d{1,5})/; // optional :port
const pathRegex = /(?:[:/?#][^\s]*)/; // path / query / fragment

export const urlRegex = new RegExp(
  '\\b' +
    '(?:' + protocolRegex.source + '|' + wwwRegex.source + ')?' + // optional protocol or www.
    hostRegex.source +
    '(?:\\.(?:' + tldRegex.source + '(?:\\.' + ccTldRegex.source + ')?|' + ccTldRegex.source + '))' + // require either TLD or ccTLD (or tld + cc)
    '(?:' + portRegex.source + ')?' + // optional port
    '(?:' + pathRegex.source + ')?' + // optional path/query/fragment
    '\\b',
  'i'
);
