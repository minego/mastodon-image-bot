# mastodon-image-bot
A very simple account to allow posting images regularly from a mastodon account


## Description
This bot allows specific senders to DM images to the bot that should be sent by
the bot later. This lets the owner of an image bot fill the bot's queue easily
using their regular Mastodon client.

Each time the bot runs it will attempt to find an image that is suitable for
posting by looking through DMs that have been sent to the bot. If one is found
then the same toot will be resent (with the leading "@botname ") removed. It
will preserve the rest of the toot's body, the CW, etc.

The notification of that DM will then be cleared so that the same image will not
be posted again.

The following options can be modified in the "options" section of the config
file:
	- random: Pick a random post from the queue to send.

	- sendOldest: By default the oldest applicable toot will be sent. If false
	then the most recent applicable toot will be sent instead.

	- times: A list of strings, each containing a time of day that the bot
	should post.

	A time value may be followed by a / and a value to indicate that it should
	only run every n times.

	A time value may also be followed by a > and a value to indicate that the
	time should be skipped if there are not at least the sepcified count of
	posts available to send.

	Example:
		Send at midnight. If there are at least 10 images in the queue then also
		send at noon.

		"times": [
			"00:00:00",
			"12:00:00 > 10"
			"18:00:00 / 3"
		]

	- visibility: The visibility that should be set for new posts. May be:
		'public' 'unlisted' 'private' or 'direct'. Default is 'public' and
		'direct' is useful for testing.

	- alltoots: By default only images will be reposted. If alltoots is true
	then all DMs sent by an authorized sender will be applicable for reposting.

	- boost: If true and there are no queued messages then the most popular toot
	previously posted by the bot will be reboosted


The bot will respond to the following commands from authorized senders:

	$count
		Report the number of currently queued items

	$review [<id> ...]
		Send all (or specified) currently queued items as DMs to the sender

