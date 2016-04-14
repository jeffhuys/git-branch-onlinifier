/* ==========
    Requires
   ========== */
var chalk               = require('chalk');
var child               = require('child_process');
var _                   = require('lodash');
var fs                  = require('fs');
var mkdirp              = require('mkdirp');
var ncp                 = require('ncp').ncp;
var rimraf              = require('rimraf');

var express             = require('express'),
    expressCookieParser = require('cookie-parser'),
    expressSession      = require('express-session')
    handlebars          = require('express-handlebars'),
    app                 = express();


/* ==========
      Main
   ========== */
console.log(chalk.bold.white('Git Branch Onlinifier'));

// Vars
var servers = [];
var hbs = handlebars.create({
    defaultLayout: 'main',
    helpers: {
        getServersOnlineCount: function() {
            return servers.length;
        }
    }
});
ncp.limit = 16;

// Get the arguments
var args = process.argv.slice(2);

if(args.length > 0) {
    switch(args[0]) {
        case '-h':
            printHelp();
            break;

        // Starts just the express server, to handle external calls
        case 'listen':
            listen();
            break;

        default:
            prepareBranch(args[0], args[1]);
            break;
    }
} else {
    logError('No arguments given. For usage information run: ' + chalk.bold('node gbo -h'));
}



/* ============
      Routes
         &
      Express
   ============ */
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');

app.use(expressCookieParser());
app.use(expressSession({secret: '1234567890QWERTY'}));

app.use(function(req, res, next) {
    res.locals = {
        messages: getToaster(req)
    }
    next();
});

app.get('/', function(req, res) {
    logDebug('GET /');
    res.render('index', { servers: servers });
});

app.get('/spawn', function(req, res) {
    logDebug('Spawning ' + req.query.branch + ' @ ' + req.query.repo);

    prepareBranch(req.query.repo, req.query.branch, function(success) {
        if(success) {
            toaster(req, 'Spawning ' + req.query.branch + '@' + req.query.repo + '. Please wait.', 1);
            res.redirect('/');
        } else {
            toaster(req, 'There has been an error spawning ' + req.query.branch + '@' + req.query.repo + '.', 3);
            res.redirect('/');
        }
    });
    
});

app.get('/list', function(req, res) {
    logDebug('GET /list');
    res.render('serverlist', { servers: servers })
});

app.get('/logs', function(req, res) {
    logDebug('GET /logs');
    res.render('logs', { });
});

app.get('/log/:id', function(req, res) {
    var server = findServerByID(req.params.id);
    
    logDebug('Rendering log for ' + req.params.id);

    res.render('log', { 'logStr': server.log });
});

app.get('/killAll', function(req, res) {
    logDebug('Killing all servers');
    killAllServers();

    toaster(req, 'Killed all servers.', 1);
    res.redirect('/');
});

app.get('/kill/:id', function(req, res) {
    logDebug('Killing ' + req.params.id);

    toaster(req, 'Killed server ' + findServerByID(req.params.id).branch + '@' + findServerByID(req.params.id).repo, 1);
    killServerByID(req.params.id);

    res.redirect('/');
})


/* =============
     Functions
   ============= */
function printHelp() {
    console.log(chalk.green('Help'));
    logDebug('Not implemented yet 🙈');
}

function listen() {
    app.listen(9999, function() {
        logDebug('Express listening on post 9999');
    });
}

function killServer(i) {
    if(servers) {
        killServerByID(i);
    }
}

function killAllServers() {
    if(servers && servers.length > 0) {
        for(var i = 0; i < servers.length; i++) {
            servers[i].process.kill();
        }

        // Empty the array of dead children
        servers = [];
    }
}

function findServerByID(id) {
    return _.find(servers, function(s) { return s.id == id;});
}

function removeServerByID(id) {
    servers = _.reject(servers, function(s) { return s.id == id; });
}

function killServerByID(id, keep) {
    var server = findServerByID(id);
    if(server) {
        if(server.process && server.process.kill())
            server.process.kill();
        else
            logDebug('Warning: server was found, but no process was attached.');
    }

    if(!keep) removeServerByID(id);
}

function randomID(arr) {
    var ID = randomString(8);
    while(findServerByID(ID)) {
        ID = randomString(8);
    }
    return ID;
}

function randomString(length) {
    var chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    var result = '';
    for (var i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}

function prepareBranch(repo, branch, callback) {
    var path = __dirname + '/repos/' + repo + '/' + branch;

    // Check if this repo + branch combination already exists in servers
    if(_.findIndex(servers, function(s) { return s.repo === repo && s.branch === branch; }) > -1 ) {
        logError('Server already exists');
        callback(false);
        return;
    }

    // Create childObject
    var childObject = {
        id: randomID(servers),
        process: undefined,
        status: 'Spawning',
        
        repo: repo,
        branch: branch,
        port: 'N/A',
        log: '',

        addToLog: function(str) {
            // Set port if port is found in log
            var port = str.match(/:[0-9]{4}\//);
            if(port && port[0] && port[0].slice(1, 5)) {
                port = port[0].slice(1, 5);
                logDebug('Port ' + port + ' detected');

                this.port = port;
                this.status = 'Up';
            }

            this.log += str;
        }
    }
    // We push childObject here, but the reference remains.
    // This means we can keep adding/changing stuff in the object 😄
    servers.push(childObject);
    callback(true);

    // Check if this repo + branch exists
    // http://stackoverflow.com/questions/4482686/check-synchronously-if-file-directory-exists-in-node-js
    try {
        fs.accessSync(path, fs.F_OK);

        // Repo + branch exists
        logDebug(path + ' existed. Removing...');
        childObject.status = 'Removing old version';

        // Remove old folder
        rimraf(path, function() {
            logDebug('Removed. Copying...');
            childObject.status = 'Copying _template';

            mkdirp(path, function(err) {
                if(err) {
                    console.error(err);
                    return;
                }

                copyTemplate(repo, branch, function(success) {
                    if(success) {
                        logDebug('Copy done.');
                        spawnBranch(childObject);
                    } else {
                        logError('copyTemplate encountered an error');
                    }
                });
            });
        });
    } catch (e) {
        // Repo + branch doesn't exist
        // Create directory
        mkdirp(path, function(err) {
            if(err) {
                console.error(err);
                return;
            }

            logDebug(path + ' created.');
            
            copyTemplate(repo, branch, function(success) {
                if(success) {
                    spawnBranch(childObject);
                } else {
                    logError('copyTemplate encountered an error');
                }
            });
        })
    }
}

function copyTemplate(repo, branch, callback) {
    var path = __dirname + '/repos/' + repo + '/' + branch;

    // Copy the template to the folder
    ncp(__dirname + '/repos/' + repo + '/_template/', path, function(err) {
        if(err) {
            callback(false);
        }

        logDebug('Copied _template to ' + path);
        callback(true);
    })
}

function spawnBranch(childObject) {
    if(!childObject) {
        logError('Child object is not here?!');
        console.dir(childObject);
    }
    console.dir(childObject);
    logDebug('Spawning branch: ' + chalk.bold.green(childObject.branch) + ' of repository: ' + chalk.bold.blue(childObject.repo));
    require('simple-git')(__dirname + '/repos/' + childObject.repo + '/' + childObject.branch)
        .outputHandler(function (command, stdout, stderr) {
                stdout.pipe(process.stdout);
                stderr.pipe(process.stderr);
             })
        .checkout(childObject.branch, function(err, data) {
            if(err) {
                console.log('ERRRRRRRORRRRRR');
            }
        })
        .pull('origin', childObject.branch, function(err, update) {
            var opts = { cwd: __dirname + '/repos/' + childObject.repo + '/' + childObject.branch };

            logDebug('Checkout done.');
            logDebug('Executing npm install...');
            childObject.status = 'npm install';

            child.exec('npm install', opts, function(err, stdout, stderr) {
                if(err) {
                    logError('npm install failed');
                    logError(err);
                    return;
                }

                logDebug('Executing bower install...');
                childObject.status = 'bower install';

                child.exec('bower install', opts, function(err, stdout, stderr) {
                    if(err) {
                        logError('bower install failed');
                        logError(err);
                        return;
                    }

                    logDebug('Executing gulp serve...');
                    childObject.status = 'gulp serve';

                    childObject.process = child.spawn('gulp', ['serve'], opts);

                    childObject.process.stdout.setEncoding('utf8');
                    childObject.process.stdout.on('data', function(data) {
                        childObject.addToLog(data);
                    });
                });
            });
        }).then(function(err, data) {
            if(err) {
                console.log('ERRORED OUT');
            }
        });
}

var toasterLevels = [
    'INFO',
    'SUCCESS',
    'WARNING',
    'DANGER'
];

function toaster(req, msg, level) {
    if(!level) var level = 0;

    if(level < 0 || level > toasterLevels.length) {
        level = 0;
    }

    if(!req.session.messages) {
        req.session.messages = [];
    }

    var message = {'text': msg, 'level': toasterLevels[level].toLowerCase()};
    req.session.messages.push(message);
    logDebug('Pushed a message');
    console.dir(message);
}

function getToaster(req) {
    var toReturn;

    if(req.session.messages) {
        toReturn = req.session.messages;
        req.session.messages = [];
    } else {
        toReturn = [];
    }

    return toReturn;
}

/* ====================
     Helper functions
   ==================== */
function logError(msg) {
    console.log(chalk.bold.red('Error: ') + msg);
}

function logDebug(msg) {
    console.log(chalk.bgBlue('Debug') + ': ' + msg);
}
