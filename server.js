require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();

// middleware
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.DB_NAME || "online_poll_creator";

const client = new MongoClient(MONGODB_URI);
let pollsCollection;

function toObjectId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

app.get("/", (req, res) => {
  res.send("Welcome to Online Poll Creator API");
});

// CREATE - Create Poll
app.post("/polls", async (req, res) => {
  try {
    const { question, options } = req.body;

    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({
        message: "Invalid payload. Provide question and at least 2 options.",
      });
    }

    const pollDoc = {
      question,
      options: options.map((option) => ({ text: option, votes: 0 })),
      createdAt: new Date(),
    };

    const result = await pollsCollection.insertOne(pollDoc);
    return res.status(201).json({
      message: "Poll created",
      pollId: result.insertedId,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create poll", error });
  }
});

// READ - Retrieve Existing Polls
app.get("/polls", async (req, res) => {
  try {
    const polls = await pollsCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    return res.status(200).json(polls);
  } catch (error) {
    return res.status(500).json({ message: "Failed to retrieve polls", error });
  }
});

// READ - Retrieve Single Poll
app.get("/polls/:id", async (req, res) => {
  const pollId = toObjectId(req.params.id);
  if (!pollId) {
    return res.status(400).json({ message: "Invalid poll id" });
  }

  try {
    const poll = await pollsCollection.findOne({ _id: pollId });
    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    return res.status(200).json(poll);
  } catch (error) {
    return res.status(500).json({ message: "Failed to retrieve poll", error });
  }
});

// UPDATE - Vote on Poll
app.put("/polls/:id/vote", async (req, res) => {
  const pollId = toObjectId(req.params.id);
  if (!pollId) {
    return res.status(400).json({ message: "Invalid poll id" });
  }

  const { optionIndex } = req.body;
  if (!Number.isInteger(optionIndex) || optionIndex < 0) {
    return res.status(400).json({ message: "Invalid optionIndex" });
  }

  try {
    const poll = await pollsCollection.findOne({ _id: pollId });
    if (!poll) {
      return res.status(404).json({ message: "Poll not found" });
    }

    if (optionIndex >= poll.options.length) {
      return res.status(400).json({ message: "optionIndex out of range" });
    }

    await pollsCollection.updateOne(
      { _id: pollId },
      { $inc: { [`options.${optionIndex}.votes`]: 1 } },
    );

    const updatedPoll = await pollsCollection.findOne({ _id: pollId });
    return res
      .status(200)
      .json({ message: "Vote recorded", poll: updatedPoll });
  } catch (error) {
    return res.status(500).json({ message: "Failed to vote", error });
  }
});

// DELETE - Delete Poll
app.delete("/polls/:id", async (req, res) => {
  const pollId = toObjectId(req.params.id);
  if (!pollId) {
    return res.status(400).json({ message: "Invalid poll id" });
  }

  try {
    const result = await pollsCollection.deleteOne({ _id: pollId });

    if (!result.deletedCount) {
      return res.status(404).json({ message: "Poll not found" });
    }

    return res.status(200).json({ message: "Poll deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete poll", error });
  }
});

async function startServer() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    pollsCollection = db.collection("polls");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Connected to MongoDB: ${DB_NAME}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

function setPollsCollection(collection) {
  pollsCollection = collection;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  toObjectId,
  setPollsCollection,
};
