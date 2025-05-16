const bs58 = require('bs58');
const testString = 'test';
const decoded = bs58.decode(testString);
console.log('Decoded:', decoded);