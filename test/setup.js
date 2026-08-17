'use strict';

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      window: {
        createStatusBarItem: (alignment, priority) => ({
          alignment,
          priority,
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          dispose: () => {},
        }),
        createOutputChannel: (name) => ({
          name,
          lines: [],
          appendLine(line) {
            this.lines.push(line);
          },
          show: () => {},
          clear() {
            this.lines = [];
          },
          dispose: () => {},
        }),
        showWarningMessage: () => {},
        showErrorMessage: () => {},
        showInformationMessage: () => {},
      },
      workspace: {
        getConfiguration: () => ({
          get: (key) => (key === 'refreshIntervalMs' ? 5000 : key === 'displayFormat' ? 'used/total' : undefined),
        }),
        onDidChangeConfiguration: (listener) => ({ dispose: () => {} }),
      },
      commands: {
        registerCommand: (command, callback) => ({ command, callback, dispose: () => {} }),
      },
      StatusBarAlignment: { Right: 2, Left: 1 },
      ExtensionMode: { Development: 1, Production: 2, Test: 3 },
    };
  }
  return originalRequire.apply(this, arguments);
};
