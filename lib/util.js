/**
 * Created by DHC on 2015/10/23.
 */

'use strict';

let crypto = require('crypto');

exports.randomValueHex = len => {
<<<<<<< HEAD
  return crypto.randomBytes(Math.ceil(len / 2))
=======
  return crypto.randomBytes(Math.ceil(len/2))
>>>>>>> 1d23fc9c61dd42f775d94b195be4375f2a036a89
    .toString('hex')
    .slice(0, len);
};
