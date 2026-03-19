const { netlifyToVercel } = require('./_adapter');
const { handler } = require('./_auth');
module.exports = async function(req, res) {
  return netlifyToVercel(handler, req, res);
};
