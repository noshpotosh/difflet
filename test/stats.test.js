const test = require('node:test');
const assert = require('node:assert/strict');
const { countLines } = require('../src/core/stats');

test('line counting handles empty, CRLF, no trailing newline and binaries', () => {
  const cases = [['', 0], ['a', 1], ['a\n', 1], ['a\r\nb', 2], ['\n\n', 2], ['\0x', null]];

  for (const [text, expectedLines] of cases) {
    assert.equal(countLines(Buffer.from(text)), expectedLines);
  }
});
