/**
 * Created by DHC on 2015/10/23.
 */

'use strict';

let crypto = require('crypto');

exports.randomValueHex = len => {
  return crypto.randomBytes(Math.ceil(len / 2))
    .toString('hex')
    .slice(0, len);
};
