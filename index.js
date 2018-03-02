const request = require('request-promise-native')
const uuid = require('uuid')
const {startProcess, killProcess, setAuthtoken} = require('./process');

const MAX_RETRY = 100

let internalApi;
let tunnels = {};

async function connect (opts) {
  opts = defaults(opts);
  validate(opts);
  if (opts.authtoken) {
    await setAuthtoken(opts.authtoken, opts.configPath);
  }
  if (!internalApi) {
    const url = await startProcess(opts);
    internalApi = request.defaults({baseUrl: url});
  }  
  return connectRetry(opts);
}

function defaults (opts) {
  opts = opts || {proto: 'http', addr: 80}
  if (typeof opts === 'function') opts = {proto: 'http', addr: 80};
  if (typeof opts !== 'object') opts = {proto: 'http', addr: opts};
  if (!opts.proto) opts.proto = 'http';
  if (!opts.addr) opts.addr = opts.port || opts.host || 80;
  if (opts.httpauth) opts.auth = opts.httpauth;
  return opts
}

function validate  (opts) {
  if (opts.web_addr === false || opts.web_addr === 'false') {
    throw new Error('web_addr:false is not supported, module depends on internal ngrok api')
  }
}

async function connectRetry (opts, retryCount = 0) {
  opts.name = String(opts.name || uuid.v4());
  try {
    const response = await internalApi.post({url: 'api/tunnels', json: opts});
    const publicUrl = response.public_url
    if (!publicUrl) {
      throw new Error(response.msg || 'failed to start tunnel')
    }
    tunnels[publicUrl] = response.uri;
    if (opts.proto === 'http' && opts.bind_tls !== false) {
      tunnels[publicUrl.replace('https', 'http')] = response.uri + ' (http)';
    }
    return publicUrl;
  } catch (err) {
    if (!isRetriable(err) || retryCount >= MAX_RETRY) {
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    return connectRetry(opts, ++retryCount);
  }
}

function isRetriable (err) {
  if (!err.response) return false; 
  const body = err.response.body
  const notReady500 = err.statusCode === 500 && /panic/.test(body)
  const notReady502 = err.statusCode === 502 && body.details && body.details.err === 'tunnel session not ready yet';
  return notReady500 || notReady502;
}

async function disconnect (publicUrl) {
  if (!internalApi) return;

  if (publicUrl) {
    const tunnelUrl = tunnels[publicUrl];
    if (!tunnelUrl) {
      throw new Error(`there is no tunnel with url: ${publicUrl}`)
    }
    await internalApi.del(tunnelUrl)
    delete tunnels[publicUrl];
    return;
  }

  const disconnectAll = Object.keys(tunnels).map(url => disconnect(url));

  return Promise.all(disconnectAll);
}

function getApiUrl() {
  if (internalApi) return 'koko';
}

async function kill ()  {
  if (!internalApi) return;
  await killProcess();
  internalApi = null;
  tunnels = {}
}

module.exports = {
  connect,
  disconnect,
  kill,
  authtoken: setAuthtoken,
  getApiUrl
};
