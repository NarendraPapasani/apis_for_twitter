const bcrypt = require('bcrypt')
const express = require('express')
const jwt = require('jsonwebtoken')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const mypath = path.join(__dirname, 'twitterClone.db')

const app = express()
app.use(express.json())
let db = null
const InitDB = async () => {
  try {
    db = await open({
      filename: mypath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('server start ayindi chusko...')
    })
  } catch (e) {
    console.log(e.message)
    process.exit(1)
  }
}

InitDB()

app.post('/register', async (req, resp) => {
  const {username, password, name, gender} = req.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const query1 = `
    SELECT * FROM user WHERE username = '${username}'
  `
  const result1 = await db.get(query1)
  if (result1 === undefined) {
    if (password.length < 6) {
      resp.status(400)
      resp.send('Password is too short')
    } else {
      const query2 = `
      INSERT INTO user(username,password,name,gender)
      VALUES('${username}','${hashedPassword}','${name}','${gender}')
    `
      const res2 = await db.run(query2)
      resp.send('User created successfully')
    }
  } else {
    resp.status(400)
    resp.send('User already exists')
  }
})

app.post('/login/', async (req, resp) => {
  const {username, password} = req.body
  const query1 = `
    SELECT * FROM user WHERE username = '${username}'
  `
  const result1 = await db.get(query1)
  if (result1 !== undefined) {
    const isPasswordMatched = await bcrypt.compare(password, result1.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      resp.send({jwtToken})
    } else {
      resp.status(400)
      resp.send('Invalid password')
    }
  } else {
    resp.status(400)
    resp.send('Invalid user')
  }
})

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

const camelCase = obj => {
  return {
    username: obj.username,
    tweet: obj.tweet,
    dateTime: obj.date_time,
  }
}

app.get('/user/tweets/feed/', authenticateToken, async (req, resp) => {
  const {username} = req
  const query = `
   SELECT
        user.username, tweet.tweet, tweet.date_time AS dateTime
        FROM
        follower
        INNER JOIN tweet
        ON follower.following_user_id = tweet.user_id
        INNER JOIN user
        ON tweet.user_id = user.user_id
        WHERE
        follower.follower_user_id = ${username}
        ORDER BY
        tweet.date_time DESC
        LIMIT 4;
  `
  const result1 = await db.all(query)
  console.log(result1)
  const res2 = await result1.map(each => camelCase(each))
  resp.send(res2)
})

app.get('/user/following/', authenticateToken, async (req, resp) => {
  const {username} = req
  const query = `
   SELECT
  u.name
  FROM
  user u
  JOIN follower f ON u.user_id = f.following_user_id
  JOIN user uf ON f.follower_user_id = uf.user_id
  WHERE
  uf.username = '${username}';
  `
  const result1 = await db.all(query)
  resp.send(result1)
})

app.get('/user/followers/', authenticateToken, async (req, resp) => {
  const {username} = req
  const query = `
   SELECT uf.name
 FROM user uf
 JOIN follower f ON uf.user_id = f.follower_user_id
 JOIN user u ON f.following_user_id = u.user_id
 WHERE u.username = '${username}';
  `
  const result1 = await db.all(query)
  resp.send(result1)
})

app.get('/tweets/:tweetId/', authenticateToken, async (req, res) => {
  const {username} = req // Assuming 'req.user' is set after authentication
  const {tweetId} = req.params

  // SQL query to check if 'username' follows the author of the tweet
  const checkFollowingQuery = `
    SELECT 
      1 
    FROM 
      follower 
      JOIN tweet ON follower.following_user_id = tweet.user_id
    WHERE 
      tweet.tweet_id = ? AND 
      follower.follower_username = ?;
  `

  try {
    const isFollowing = await db.get(checkFollowingQuery, [tweetId, username])

    if (!isFollowing) {
      return res.status(401).send('Invalid Request')
    }

    // SQL query to get the tweet details if 'username' follows the author of the tweet
    const getTweetDetailsQuery = `
      SELECT 
        t.tweet,
        (SELECT COUNT(*) FROM like WHERE tweet_id = t.tweet_id) AS likes_count,
        (SELECT COUNT(*) FROM reply WHERE tweet_id = t.tweet_id) AS replies_count,
        t.date_time
      FROM 
        tweet t
      WHERE 
        t.tweet_id = ${tweetId};
    `

    const tweetDetails = await db.get(getTweetDetailsQuery, [$(tweetId)])

    if (!tweetDetails) {
      return res.status(404).send('Tweet not found')
    }

    res.json(tweetDetails)
  } catch (error) {
    res.status(500).send('Server error')
  }
})

app.get('/tweets/:tweetId/likes/', authenticateToken, async (req, res) => {
  const {tweetId} = req.params
  const {username} = req // Assuming 'req.user' is set after authentication

  // SQL query to check if 'username' follows the author of the tweet
  const checkFollowingQuery = `
    SELECT 
      * 
    FROM 
      follower 
      JOIN tweet ON follower.following_user_id = tweet.user_id
    WHERE 
      tweet.tweet_id = ? AND 
      follower.follower_user_id = (SELECT user_id FROM user WHERE username = ?);
  `

  try {
    const isFollowing = await db.get(checkFollowingQuery, [tweetId, username])

    if (!isFollowing) {
      return res.status(401).send('Invalid Request')
    }

    // SQL query to get usernames who liked the tweet if 'username' follows the author
    const getLikesQuery = `
      SELECT 
        user.username 
      FROM 
        like 
        JOIN user ON like.user_id = user.user_id
      WHERE 
        like.tweet_id = ?;
    `

    const likesResult = await db.all(getLikesQuery, [tweetId])
    const likes = likesResult.map(row => row.username)

    res.json({likes})
  } catch (error) {
    res.status(500).send(error.message)
  }
})

app.get('/tweets/:tweetId/replies/', authenticateToken, async (req, res) => {
  try {
    const {tweetId} = req.params
    const {username} = req // Assuming 'req.user' is set after authentication

    // Check if 'username' follows the author of the tweet
    const checkFollowingQuery = `
      SELECT 
        * 
      FROM 
        follower 
        JOIN tweet ON follower.following_user_id = tweet.user_id
      WHERE 
        tweet.tweet_id = ? AND 
        follower.follower_user_id = (SELECT user_id FROM user WHERE username = ?);
    `

    const isFollowing = await db.get(checkFollowingQuery, [tweetId, username])

    if (!isFollowing) {
      return res.status(401).send('Invalid Request')
    }

    // Get the tweet
    const getTweetQuery = `
      SELECT 
        tweet.tweet,
        user.name
      FROM 
        tweet
        JOIN user ON tweet.user_id = user.user_id
      WHERE 
        tweet.tweet_id = ?;
    `

    const tweetResult = await db.get(getTweetQuery, [tweetId])

    if (!tweetResult) {
      return res.status(404).send('Tweet not found')
    }

    // Get replies if 'username' follows the author of the tweet
    const getRepliesQuery = `
      SELECT 
        user.name,
        reply.reply 
      FROM 
        reply 
        JOIN user ON reply.user_id = user.user_id
      WHERE 
        reply.tweet_id = ?;
    `

    const repliesResult = await db.all(getRepliesQuery, [tweetId])

    // Map replies to desired format
    const replies = repliesResult.map(row => ({
      name: row.name,
      reply: row.reply,
    }))

    // Combine tweet and replies in response
    res.json({
      tweet: {
        name: tweetResult.name,
        tweet: tweetResult.tweet,
      },
      replies,
    })
  } catch (error) {
    res.status(500).send('Server error')
  }
})

app.get('/user/tweets/', authenticateToken, async (req, res) => {
  const {username} = req // Extracted from JWT after authentication

  // SQL query to get all tweets of the user along with likes and replies count
  const query = `
    SELECT 
      tweet.tweet, 
      COUNT(DISTINCT like.like_id) AS likes,
      COUNT(DISTINCT reply.reply_id) AS replies,
      tweet.date_time
    FROM 
      tweet 
      LEFT JOIN like ON tweet.tweet_id = like.tweet_id
      LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE 
      tweet.user_id = (SELECT user_id FROM user WHERE username = ?)
    GROUP BY 
      tweet.tweet_id;
  `

  try {
    const tweets = await db.all(query, [username])

    // Format the date-time and send the response
    const formattedTweets = tweets.map(tweet => ({
      ...tweet,
      dateTime: new Date(tweet.dateTime).toISOString(),
    }))

    res.json(formattedTweets)
  } catch (error) {
    res.status(500).send('Server error')
  }
})

app.post('/user/tweets/', authenticateToken, async (req, res) => {
  const {username} = req // Extracted from JWT after authentication
  const {tweet} = req.body

  // SQL query to insert a new tweet for the user
  const query = `
    INSERT INTO 
      tweet (tweet, user_id, date_time)
    VALUES 
      (?, (SELECT user_id FROM user WHERE username = ?), ?);
  `

  const dateTime = new Date().toISOString() // Current date-time in ISO format

  try {
    await db.run(query, [tweet, username, dateTime])
    res.send('Created a Tweet')
  } catch (error) {
    res.status(500).send('Server error')
  }
})

app.delete('/tweets/:tweetId/', authenticateToken, async (req, res) => {
  const {tweetId} = req.params
  const {username} = req // Extracted from JWT after authentication

  // SQL query to find the tweet by id and check if it belongs to the authenticated user
  const findTweetQuery = `
    SELECT 
      * 
    FROM 
      tweet 
    WHERE 
      tweet_id = ? AND 
      user_id = (SELECT user_id FROM user WHERE username = ?);
  `

  try {
    const tweet = await db.get(findTweetQuery, [tweetId, username])

    if (tweet) {
      // SQL query to delete the tweet if it belongs to the authenticated user
      const deleteTweetQuery = `
        DELETE FROM 
          tweet 
        WHERE 
          tweet_id = ?;
      `

      await db.run(deleteTweetQuery, [tweetId])
      res.send('Tweet Removed')
    } else {
      // If the tweet does not belong to the authenticated user or does not exist
      res.status(401).send('Invalid Request')
    }
  } catch (error) {
    res.status(500).send('Server error')
  }
})

module.exports = app
