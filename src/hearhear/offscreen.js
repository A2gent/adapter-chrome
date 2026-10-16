import { Player } from './player.js';
import { synthesize } from './speech.js';
const player = new Player(new Audio(), synthesize);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab) return;
  if (message.action === 'start') {
    // Acknowledge immediately; do not keep a service-worker message alive during TTS.
    void player.start(message.owner, message);
    reply(player.status(message.owner));
    return;
  }
  player.command(message.owner, message.action, message.value)
    .then(() => reply(player.status(message.owner)), error => reply({phase:'error', error:error.message}));
  return true;
});
