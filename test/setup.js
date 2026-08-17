'use strict';

const Module = require('module');
const originalRequire = Module.prototype.require;

const state = {};

function reset() {
  state.config = {
    refreshIntervalMs: 5000,
    displayFormat: 'used/total',
  };
  state.statusBarItems = [];
  state.outputChannels = [];
  state.warnings = [];
  state.errors = [];
  state.information = [];
  state.configurationListeners = [];
  state.commands = new Map();
}

reset();

const vscodeMock = {
  window: {
    createStatusBarItem: (alignment, priority) => {
      const item = {
        alignment,
        priority,
        text: '',
        tooltip: '',
        command: '',
        showCount: 0,
        show() {
          this.showCount += 1;
        },
        dispose: () => {},
      };
      state.statusBarItems.push(item);
      return item;
    },
    createOutputChannel: (name) => {
      const channel = {
        name,
        lines: [],
        showCount: 0,
        appendLine(line) {
          this.lines.push(line);
        },
        show() {
          this.showCount += 1;
        },
        clear() {
          this.lines = [];
        },
        dispose: () => {},
      };
      state.outputChannels.push(channel);
      return channel;
    },
    showWarningMessage: (message) => state.warnings.push(message),
    showErrorMessage: (message) => state.errors.push(message),
    showInformationMessage: (message) => state.information.push(message),
  },
  workspace: {
    getConfiguration: () => ({
      get: (key) => state.config[key],
    }),
    onDidChangeConfiguration: (listener) => {
      state.configurationListeners.push(listener);
      return { dispose: () => {} };
    },
  },
  commands: {
    registerCommand: (command, callback) => {
      state.commands.set(command, callback);
      return { command, callback, dispose: () => {} };
    },
  },
  StatusBarAlignment: { Right: 2, Left: 1 },
  ExtensionMode: { Development: 1, Production: 2, Test: 3 },
};

Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return vscodeMock;
  }
  return originalRequire.apply(this, arguments);
};

module.exports = { reset, state, vscodeMock };
