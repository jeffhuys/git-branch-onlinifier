/* ==========
    Requires
   ========== */
var chalk               = require('chalk');
var child               = require('child_process');
var _                   = require('lodash');

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
})

// Get the arguments
var args = process.argv.slice(2);

if(args.length > 0) {
    switch(args[0]) {
        case '-h':
            printHelp();
            break;

        case 'init':
            printHelp();
            break;

        // Starts just the express server, to handle external calls
        case 'listen':
            listen();
            break;

        default:
            spawnBranch(args[0], args[1]);
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
    spawnBranch(req.query.repo, req.query.branch);

    toaster(req, 'Spawning ' + req.query.branch + '@' + req.query.repo + '. Please wait.');
    res.redirect('/');
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

    toaster(req, 'Killed all servers.');
    res.redirect('/');
});

app.get('/kill/:id', function(req, res) {
    logDebug('Killing ' + req.params.id);

    toaster(req, 'Killed server ' + findServerByID(req.params.id).branch + '@' + findServerByID(req.params.id).repo);
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
    findServerByID(id).process.kill();

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

function spawnBranch(repoName, branchName) {
    var childObject = {
        id: randomID(servers),
        process: undefined,
        status: 'Spawning',
        
        repo: repoName,
        branch: branchName,
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
    servers.push(childObject);

    logDebug('Spawning branch: ' + chalk.bold.green(branchName) + ' of repository: ' + chalk.bold.blue(repoName));
    require('simple-git')(__dirname + '/repos/' + repoName)
        .outputHandler(function (command, stdout, stderr) {
                stdout.pipe(process.stdout);
                stderr.pipe(process.stderr);
             })
        .pull()
        .checkout(branchName)
        .pull(function(err, update) {
            var opts = { cwd: __dirname + '/repos/' + repoName };

            logDebug('Checkout done.');
            logDebug('Executing npm install...');
            child.exec('npm install', opts, function(err, stdout, stderr) {
                if(err) {
                    logError('npm install failed');
                    logError(err);
                    return;
                }

                logDebug('Executing bower install...');
                child.exec('bower install', opts, function(err, stdout, stderr) {
                    if(err) {
                        logError('bower install failed');
                        logError(err);
                        return;
                    }

                    logDebug('Executing gulp serve...');
                    childObject.process = child.spawn('gulp', ['serve'], opts);

                    childObject.process.stdout.setEncoding('utf8');
                    childObject.process.stdout.on('data', function(data) {
                        childObject.addToLog(data);
                    });
                });
            });
        });
}

function toaster(req, msg) {

    if(!req.session.messages) {
        req.session.messages = [];
    }

    req.session.messages.push({'text': msg});
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
