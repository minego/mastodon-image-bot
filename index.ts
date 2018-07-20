import Mastodon		= require('mastodon-api');
import readline		= require('readline');
import https		= require('https');
import fs			= require('fs');
import util			= require('util');
import striptags	= require('striptags');
import program		= require('commander');
import ontime		= require('ontime');
const Entities		= require('html-entities').AllHtmlEntities;
const entities		= new Entities();
const pkg			= require(__dirname + '/package.json');

const writeFile		= util.promisify(fs.writeFile);

function addToList(value, list)
{
	list.push(value);
	return(list);
}

program
.version(pkg.version)
.option('-c, --config <path>',		'Specify the config file that should be used', __dirname + '/config.json')

.option('--authorize',				'Authorize for use with an account, and exit')
.option('-t, --trust <user>',		'Specify a username that should be trusted, and exit', addToList, [])
.option('-d, --distrust <user>',	'Specify a username that should no longer be trusted, and exit', addToList, [])
.option('-D, --dryrun',				'Print info about what would be done, but do not do anything')

program.parse(process.argv);
let opts = program.opts();


let rl;
let M;
let config;

try {
	config = JSON.parse(fs.readFileSync(opts['config'], 'utf8'));

	config.url.base		= `https://${config.url.host}`;
	config.url.endpoint	= `${config.url.base}/api/v1/`;
} catch (e) {
	if (e.code !== 'ENOENT') {
		console.error(e);
		process.exit(1);
	}

	// console.error(e);
	config = {
		senders:			[],
		options: {
			sendOldest:		true,
			visibility:		"public",
			times:			[],
			alltoots:		false
		}
	};
}

function ask(question: string): Promise<string>
{
	if (!rl) {
		rl = readline.createInterface({
			input:	process.stdin,
			output:	process.stdout
		});
	}

	return new Promise((resolve, reject) => {
		rl.question(question, (answer) => {
			resolve(answer);
			// rl.close();
		});
	});
}

// TODO Add an option to add an authorized sender or remove one
function Authorize()
{
	ask('Instance host: ')
	.then((host) => {
		config.url			= {};
		config.url.host		= host;
		config.url.base		= `https://${config.url.host}`;
		config.url.endpoint	= `${config.url.base}/api/v1/`;

		// console.log('Using url: ', config.url.endpoint);
		return Mastodon.createOAuthApp(config.url.endpoint + 'apps', 'mastodon-image-bot');
	})
	.then((res) => {
		// console.log(res);

		config.client = {
			id:		res.client_id,
			secret:	res.client_secret
		};
		return(Mastodon.getAuthorizationUrl(config.client.id, config.client.secret, config.url.base));
	})
	.then((url) => {
		console.log('This is the authorization URL. Open it in your browser and authorize with your account!');
		console.log(url);

		return ask('Please enter the code: ');
	})
	.then((code) => {
		return Mastodon.getAccessToken(config.client.id, config.client.secret, code, config.url.base);
	})
	.then((accessToken) => {
		console.log(`Success!\n${accessToken}`);

		config.accessToken = accessToken;

		// console.log(JSON.stringify(config, null, 4));
		return writeFile(opts['config'], JSON.stringify(config, null, 4), 'utf8');
	})
	.then(() => {
		console.log('Config successfully stored; run again to start');
	})
	.finally(() => {
		rl.close();
		rl = null;
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	})
}

function Dismiss(id: number): Promise<void>
{
	if (opts['dryrun']) {
		console.log('NOT Dismissing: ' + id);
		return Promise.resolve();
	}

	console.log('Dismissing: ' + id);
	return M.post('notifications/dismiss', { id: id })
	.then((res) => {
		return;
	});
}

function DownloadImage(id: number, url: string): Promise<string>
{
	return new Promise((resolve, reject) => {
		let name = `/tmp/mastodon-image-bot-${id}`;
		let file = fs.createWriteStream(name);

		let req = https.get(url, function(res) {
			res.pipe(file);
			res.on('end', function() {
				file.close();
				resolve(name);
			});
		});
	});
}

function AttachImage(id: number, url: string, description ?: string): Promise<number>
{
	let imgpath;

	return DownloadImage(id, url)
	.then((path) => {
		imgpath = path;

		let options = { file: fs.createReadStream(imgpath) };

		if (description) {
			(options as any).description = description;
		}

		return M.post('media', options);
	})
	.then((res) => {
		fs.unlinkSync(imgpath);
		return(parseInt(res.data.id));
	});
}

function Post(text, media, sensitive, cw): Promise<any>
{
	/*
		Cleanup the status text which comes in as HTML and likely starts with a
		mention of the bot's username.
	*/
	let parts = entities.decode(striptags(text)).split(' ');
	while (parts[0] && 0 == parts[0].indexOf('@')) {
		parts.shift();
	}

	let options = {
		status:			parts.join(' '),
		media_ids:		media,
		sensitive:		sensitive,
		visibility:		config.options.visibility || "public"
	};

	if (cw) {
		options['spoiler_text'] = cw;
	}

	return M.post('statuses', options)
	.then((res) => {
		console.log('new status results: ', res.data);
	});
}

function FindImage(): Promise<any>
{
	if (!config.senders) {
		console.log('WARNING: There are no allowed senders');
		process.exit(1);
	}

	let options = {
		only_media:		true,
		limit:			30,
		exclude_types:	[ 'follow', 'favourite', 'reblog' ]
	};

	let image;

	return M.get('notifications', options).then((res) => {
		// console.log(res.data)

		let p = [];

		// TODO Add an option for randomizing the order of the posts before we
		//		look for a match.
		for (let post of res.data) {
			if (-1 === post.account.acct.indexOf('@')) {
				/* Sent from local instance */
				post.account.acct += '@' + config.url.host;
			}

			if (!post.account || -1 == config.senders.indexOf(post.account.acct)) {
				/* This sender isn't authorized */
				// console.log('not allowed', post.account.acct, config.senders);
				p.push(Dismiss(post.id).catch(err => console.log(err)));
				continue;
			}

			if (post.status.visibility !== 'direct') {
				/* Only resend direct messages */
				p.push(Dismiss(post.id).catch(err => console.log(err)));
				continue;
			}

			if (!post.status.media_attachments || !post.status.media_attachments[0]) {
				/* We currently only want posts with media */
				if (!config.options.alltoots) {
					p.push(Dismiss(post.id).catch(err => console.log(err)));
					continue;
				}
			}

			// console.log('Possible image post: ', post);
			image = post;

			if (!config.options.sendOldest) {
				break;
			}
		}

		/* Wait for all dismiss requests to finish */
		return(Promise.all(p));
	})
	.then(() => {
		if (!image) {
			console.error('No suitable images found');
			return;
		}

		if (opts['dryrun']) {
			console.log('NOT reposting: ', image);

			for (let attachment of image.status.media_attachments) {
				console.log(attachment);
			}
			return;
		}

		/* Re-upload the images */
		let media = [];

		for (let attachment of image.status.media_attachments) {
			// console.log(attachment);
			media.push(AttachImage(attachment.id, attachment.url, attachment.description));
		}

		return Promise.all(media);
	})
	.then((media_ids) => {
		if (!media_ids) {
			return;
		}

		return Dismiss(image.id)
		.then(() => {
			return Post(image.status.content, media_ids, image.status.sensitive, image.status.spoiler_text)
		});
	});
}

if (!config || !config.url || !config.accessToken || opts['authorize']) {
	console.log('First use; configuring');
	Authorize();
} else {
	M = new Mastodon({
		access_token:	config.accessToken,
		api_url:		config.url.endpoint
	});

	if (opts['trust'].length > 0 || opts['distrust'].length > 0) {
		if (opts['trust']) {
			for (let addr of opts['trust']) {
				/* We don't want a leading @ */
				addr = addr.replace(/^@/, '');

				if (-1 === config.senders.indexOf(addr)) {
					config.senders.push(addr);
				}
			}
		}

		if (opts['distrust']) {
			for (let addr of opts['distrust']) {
				let i;

				/* We don't want a leading @ */
				addr = addr.replace(/^@/, '');

				if (-1 !== (i = config.senders.indexOf(addr))) {
					config.senders.splice(i, 1);
				}
			}
		}

		writeFile(opts['config'], JSON.stringify(config, null, 4), 'utf8')
		.then(() => {
			process.exit(0);
		});
	} else {
		/* Normal mode; look for an image to post */
		if (config.options.times) {
			ontime({
				cycle:	config.options.times,
				utc:	false,
				single:	false,
				log:	true
			}, (ot) => {
				FindImage()
				.then(() => {
					ot.done();
				});
			});
		} else {
			FindImage();
		}
	}
}

