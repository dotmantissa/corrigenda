import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(
  process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    ? new EnvHttpProxyAgent()
    : new Agent({ connect: { family: 4, autoSelectFamily: false, timeout: 15000 } }),
);
