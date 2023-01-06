const fs = require('fs');
const fs_async = require('fs/promises');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

/**
 * Utility to read a file as a promise
 */
function readFile(path) {
    return new Promise((resolve, reject) => {
        fs.readFile(path, (error, data) => error ? reject(error) : resolve(data));
    })
}

const wasmBin = fs.readFileSync(path.join(__dirname, './node_modules/vscode-oniguruma/release/onig.wasm')).buffer;
const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
    return {
        createOnigScanner(patterns) { return new oniguruma.OnigScanner(patterns); },
        createOnigString(s) { return new oniguruma.OnigString(s); }
    };
});

// Create a registry that can create a grammar from a scope name.
const registry = new vsctm.Registry({
    onigLib: vscodeOnigurumaLib,
    loadGrammar: (scopeName) => {
        if (scopeName === 'source.js') {
            // https://github.com/textmate/javascript.tmbundle/blob/master/Syntaxes/JavaScript.plist
            return readFile('./grammars/JavaScript.plist').then(data => vsctm.parseRawGrammar(data.toString()))
        }
        console.log(`Unknown scope name: ${scopeName}`);
        return null;
    }
});

const clientVariableName = "client";
const scopeFunctionCall = 'meta.function-call.js';
const scopeFunctionCallEnd = 'punctuation.definition.function-call.end.js';

// Load the JavaScript grammar and any other grammars included by it async.
registry.loadGrammar('source.js').then(grammar => {

    let filename = 'search-json.js';

    fs_async.open(filename).then(file => {

        const readInterface = file.readLines();

        let ruleStack = vsctm.INITIAL;
        let lineNum = 1;
        let command = "";
        let commandStart = -1;
        let commandEnd = -1;
        let clientMethodCalls = {};

        readInterface.on('line', function(line) {
            const lineTokens = grammar.tokenizeLine(line, ruleStack);

            let clientCall = false;

            console.log(`\nTokenizing line: ${line}`);
            for (let j = 0; j < lineTokens.tokens.length; j++) {
                const token = lineTokens.tokens[j];
                const tokenSource = line.substring(token.startIndex, token.endIndex);

                console.log(` - token from ${token.startIndex} to ${token.endIndex} ` +
                    `(${tokenSource}) ` +
                    `with scopes ${token.scopes.join(', ')}`
                );

                const trimmedTokenSource = tokenSource.trim();

                if (token.scopes[0] === 'source.js') {
                    // Module command
                    if (trimmedTokenSource.startsWith(clientVariableName + '.')) {
                        clientCall = true;
                        if (trimmedTokenSource.length > clientVariableName.length + 1) {
                            command = trimmedTokenSource.substring(clientVariableName.length + 1)
                            continue;
                        }
                    }

                    if (clientCall && commandStart === -1 && token.scopes.indexOf(scopeFunctionCall) !== -1) {
                        commandStart = lineNum;
                        command += trimmedTokenSource;

                        // todo: validate command

                        continue;
                    }

                    if (commandStart !== -1 && token.scopes.indexOf(scopeFunctionCallEnd) !== -1) {
                        commandEnd = lineNum;
                    }
                }
            }
            ruleStack = lineTokens.ruleStack;

            //command = command.toUpperCase()

            if (command.length > 0 && commandStart > 0 && commandEnd > 0) {
                if (Object.hasOwn(clientMethodCalls, command)) {
                    clientMethodCalls[command].push({start: commandStart, end: commandEnd})
                } else {
                    clientMethodCalls[command] = [{start: commandStart, end: commandEnd}]
                }
            }

            if (command.length > 0 && commandStart > 0 && commandEnd === -1) {
                // todo: check lines limit
            } else {
                command = '';
                commandStart = -1;
                commandEnd = -1;
            }

            lineNum++;
        })

        readInterface.on('close', function (){
            console.log(clientMethodCalls)
        })
    });
});