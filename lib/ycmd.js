/**
 * Created by DHC on 2015/10/23.
 */

'use strict';

let promisify = require('promisify-node');
let fs = promisify('fs');
let childProcess = require('child_process');
let crypto = require('crypto');
let url = require('url');
let portfinder = promisify('portfinder');
let temporary = require('temporary');
let request = promisify(require('request').defaults({
  json: true,
  headers: {
    'Accept': 'application/json'
  }
}));
let debug = require('debug')('ycmd');
let util = require('./util');

const HMAC_SECRET_LENGTH = 16;
const SERVER_IDLE_SUICIDE_SECONDS = 10800; // 3 hrs
const PATH_TO_CMD = '';
const HOST = '127.0.0.1';
const DEFINED_SUBCOMMANDS_HANDLER = '/defined_subcommands';
const CODE_COMPLETIONS_HANDLER = '/completions';
const COMPLETER_COMMANDS_HANDLER = '/run_completer_command';
const EVENT_HANDLER = '/event_notification';
const EXTRA_CONF_HANDLER = '/load_extra_conf_file';

// Event Type
const Event = {
  FileReadyToParse: 1,
  BufferUnload: 2,
  BufferVisit: 3,
  InsertLeave: 4,
  CurrentIdentifierFinished: 5
};


class YcmdHandle {
  constructor(popenHandle, port, hmacSecret) {
    this.popenHandle = popenHandle;
    this.port = port;
    this.hmacSecret = hmacSecret;
  }

  /**
   * Start Ycmd daemon and return spawn handle
   *
   * @returns {Promise.<T>}
   * @constructor
   */
  static StartYcmdAndReturnHandle() {
    let preparedOptions = {};
    let hmacSecret = util.randomValueHex(HMAC_SECRET_LENGTH);
    preparedOptions.hmac_secret = new Buffer(hmacSecret).toString('base64');

    let optionsFile = new temporary.File();
    debug('generate tempfile %s', optionsFile.path);
    return fs.writeFile(optionsFile.path, JSON.stringify(preparedOptions))
      .then(() => {
        return portfinder.getPort();
      })
      .then(port => {
        let handle = childProcess.spawn(PATH_TO_CMD, [
          `--port=${port}`,
          `--options_file=${optionsFile.path}`,
          `--idle_suicide_seconds=${SERVER_IDLE_SUICIDE_SECONDS}`
        ]);
        handle.isAlive = true;
        handle.on('error', () => {
          handle.isAlive = false;
        });
        handle.on('exit', () => {
          handle.isAlive = false;
        });
        return Promise.resolve(new YcmdHandle(handle, port, hmacSecret));
      })
      .catch(err => {
        console.error(err);
      });
  }

  /**
   * Detect whether daemon is alive or not
   *
   * @returns {YcmdHandle.isAlive|boolean}
   */
  isAlive() {
    return this.popenHandle.isAlive;
  }

  /**
   * Detect whether daemon is ready or not
   *
   * @param includeSubservers
   * @returns {*}
   */
  isReady(includeSubservers = true) {
    if(!this.isAlive()) {
      return false;
    }
    let params = includeSubservers ? {include_subservers: 1} : {};
    let uri = url.format({
      hostname: HOST,
      port: this.port
    });
    return request({
      uri: uri,
      headers: {
        HMAC_HEADER: this.createRequestHmac('GET', url.parse(uri).path, '')
      },
      qs: params
    });
  }

  shutdown() {
    if(this.isAlive()) {
      this.popenHandle.kill();
    }
  }

  /**
   * Send Defined Subcommands Request
   *
   * @param {string} completerTarget completerTarget
   * @returns {Promise.<T>} request promise
   */
  sendDefinedSubcommandsRequest(completerTarget) {
    debug('sending defined subcommands request');
    return this.buildRequestData(
      null,
      null,
      null,
      null,
      null,
      completerTarget
    )
      .then(requestData => {
        return this.sendRequest('post', DEFINED_SUBCOMMANDS_HANDLER, requestData);
      });
  }

  /**
   *
   * @param filename
   * @param fileType
   * @param lineNum
   * @param columnNum
   * @returns {Promise.<T>}
   */
  sendCodeCompletionRequest(filename, fileType, lineNum, columnNum) {
    debug('sending code-completion request');
    return this.buildRequestData(
      filename,
      fileType,
      lineNum,
      columnNum
    )
      .then(requestData => {
        return this.sendRequest('post', CODE_COMPLETIONS_HANDLER, requestData);
      });
  }

  sendGoToRequest(filename, fileType, lineNum, columnNum) {
    debug('sending GoTo request');
    return this.buildRequestData(
      filename,
      fileType,
      lineNum,
      columnNum,
      ['GoTo']
    )
      .then(requestData => {
        return this.sendRequest('post', COMPLETER_COMMANDS_HANDLER, requestData);
      });
  }

  sendEventNotification(eventEnum, filename, fileType, lineNum, columnNum, extraData = null) {
    debug('sending event notification');
    return this.buildRequestData(
      filename,
      fileType,
      lineNum,
      columnNum
    )
      .then(requestData => {
        return this.sendRequest('post', EVENT_HANDLER, requestData);
      });
  }

  loadExtraConfFile(extraConfFileName) {
    return this.sendRequest('post', EXTRA_CONF_HANDLER, {'filepath': extraConfFileName});
  }

  sendRequest(method, handler, data = null) {
    return request({
      method: method,
      uri: url.format({
        hostname: HOST,
        port: this.port,
        pathname: handler
      }),
      headers: {
        'X-Ycm-Hmac': this.createRequestHmac(method, handler, data)
      },
      body: data
    });
  }

  contentHmacValid(content, hmac) {
    return this.createHmac(content) === hmac;
  }

  createRequestHmac(method, path, body) {
    let methodHmac = this.createHmac(method);
    let pathHmac = this.createHmac(path);
    let bodyHmac = this.createHmac(body);

    let joinedHmacInput = [methodHmac, pathHmac, bodyHmac].join('');
    return this.createHmac(joinedHmacInput);
  }

  /**
   * @param content
   * @returns Buffer
   */
  createHmac(content) {
    return crypto.createHmac('sha256', this.hmacSecret).update(content).digest('base64');
  }

  /**
   * @param filePath
   * @param fileType
   * @param lineNum
   * @param columnNum
   * @param commandArguments
   * @param completerTarget
   * @returns {Promise.<T>}
   */
  buildRequestData(filePath = null,
                   fileType = null,
                   lineNum = null,
                   columnNum = null,
                   commandArguments = null,
                   completerTarget = null) {
    return fs.readFile(filePath)
      .then(contents => {
        let data = {
          'line_num': lineNum,
          'column_num': columnNum,
          'filepath': filePath,
          'file_data': {
            'test_path': {
              'filetypes': [ fileType ],
              'contents': contents
            }
          }
        };
        if (commandArguments) {
          data.command_arguments = commandArguments;
        }
        if (completeTarget) {
          data.completer_target = completerTarget;
        }

        return Promise.resolve(data);
      });
  }
}

module.exports = YcmdHandle;