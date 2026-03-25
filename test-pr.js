const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { MongoClient, ObjectId } = require("mongodb");

const { app, setPollsCollection } = require("./server");

function clonePoll(poll) {
  return {
    ...poll,
    options: poll.options.map((option) => ({ ...option })),
  };
}

function createInMemoryPollsCollection() {
  const polls = [];

  return {
    async insertOne(doc) {
      const _id = new ObjectId();
      polls.push({
        _id,
        question: doc.question,
        options: doc.options.map((option) => ({ ...option })),
        createdAt: doc.createdAt,
      });

      return { insertedId: _id };
    },

    find() {
      return {
        sort() {
          const sorted = [...polls].sort((a, b) => b.createdAt - a.createdAt);
          return {
            async toArray() {
              return sorted.map((poll) => clonePoll(poll));
            },
          };
        },
      };
    },

    async findOne(filter) {
      const match = polls.find(
        (poll) => poll._id.toString() === filter._id.toString(),
      );
      return match ? clonePoll(match) : null;
    },

    async updateOne(filter, update) {
      const match = polls.find(
        (poll) => poll._id.toString() === filter._id.toString(),
      );

      if (!match) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      const [path, incrementBy] = Object.entries(update.$inc)[0];
      const optionIndex = Number(path.split(".")[1]);

      match.options[optionIndex].votes += incrementBy;
      return { matchedCount: 1, modifiedCount: 1 };
    },

    async deleteOne(filter) {
      const index = polls.findIndex(
        (poll) => poll._id.toString() === filter._id.toString(),
      );

      if (index === -1) {
        return { deletedCount: 0 };
      }

      polls.splice(index, 1);
      return { deletedCount: 1 };
    },
  };
}

function createRequest(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body ? JSON.stringify(body) : null;

    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : {},
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let parsedBody = raw;
          if (raw) {
            try {
              parsedBody = JSON.parse(raw);
            } catch {
              parsedBody = raw;
            }
          }

          resolve({
            status: response.statusCode,
            body: parsedBody,
          });
        });
      },
    );

    request.on("error", reject);

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

let server;

test.before(async () => {
  server = app.listen(0);
  await once(server, "listening");
});

test.after(async () => {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

test("GET / should return welcome message", async () => {
  setPollsCollection(createInMemoryPollsCollection());

  const response = await createRequest(server, "GET", "/");

  assert.equal(response.status, 200);
  assert.equal(response.body, "Welcome to Online Poll Creator API");
});

test("POST /polls should reject invalid payload", async () => {
  setPollsCollection(createInMemoryPollsCollection());

  const response = await createRequest(server, "POST", "/polls", {
    question: "Only one option",
    options: ["A"],
  });

  assert.equal(response.status, 400);
  assert.equal(
    response.body.message,
    "Invalid payload. Provide question and at least 2 options.",
  );
});

test("POST /polls and GET /polls/:id should create and read poll", async () => {
  setPollsCollection(createInMemoryPollsCollection());

  const createResponse = await createRequest(server, "POST", "/polls", {
    question: "Best language?",
    options: ["JavaScript", "Python"],
  });

  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.body.message, "Poll created");
  assert.ok(createResponse.body.pollId);

  const pollId = createResponse.body.pollId;
  const getResponse = await createRequest(server, "GET", `/polls/${pollId}`);

  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.body.question, "Best language?");
  assert.equal(getResponse.body.options.length, 2);
  assert.equal(getResponse.body.options[0].votes, 0);
  assert.equal(getResponse.body.options[1].votes, 0);
});

test("GET /polls/:id should reject invalid id", async () => {
  setPollsCollection(createInMemoryPollsCollection());

  const response = await createRequest(
    server,
    "GET",
    "/polls/not-an-object-id",
  );

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Invalid poll id");
});

test("PUT /polls/:id/vote should reject invalid optionIndex", async () => {
  setPollsCollection(createInMemoryPollsCollection());

  const poll = await createRequest(server, "POST", "/polls", {
    question: "Favorite stack?",
    options: ["MERN", "MEAN"],
  });

  const response = await createRequest(
    server,
    "PUT",
    `/polls/${poll.body.pollId}/vote`,
    { optionIndex: -1 },
  );

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Invalid optionIndex");
});

test("PUT /polls/:id/vote should increment votes", async () => {
  setPollsCollection(createInMemoryPollsCollection());

  const poll = await createRequest(server, "POST", "/polls", {
    question: "Favorite editor?",
    options: ["VS Code", "Vim"],
  });

  const voteResponse = await createRequest(
    server,
    "PUT",
    `/polls/${poll.body.pollId}/vote`,
    { optionIndex: 1 },
  );

  assert.equal(voteResponse.status, 200);
  assert.equal(voteResponse.body.message, "Vote recorded");
  assert.equal(voteResponse.body.poll.options[1].votes, 1);
});

test("PUT /polls/:id/vote should reject out-of-range optionIndex", async () => {
  setPollsCollection(createInMemoryPollsCollection());

  const poll = await createRequest(server, "POST", "/polls", {
    question: "Favorite OS?",
    options: ["Linux", "Windows"],
  });

  const voteResponse = await createRequest(
    server,
    "PUT",
    `/polls/${poll.body.pollId}/vote`,
    { optionIndex: 2 },
  );

  assert.equal(voteResponse.status, 400);
  assert.equal(voteResponse.body.message, "optionIndex out of range");
});

test("DELETE /polls/:id should remove poll", async () => {
  setPollsCollection(createInMemoryPollsCollection());

  const poll = await createRequest(server, "POST", "/polls", {
    question: "Favorite DB?",
    options: ["MongoDB", "PostgreSQL"],
  });

  const deleteResponse = await createRequest(
    server,
    "DELETE",
    `/polls/${poll.body.pollId}`,
  );

  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteResponse.body.message, "Poll deleted");

  const getDeleted = await createRequest(
    server,
    "GET",
    `/polls/${poll.body.pollId}`,
  );

  assert.equal(getDeleted.status, 404);
  assert.equal(getDeleted.body.message, "Poll not found");
});

test("DELETE /polls/:id should reject invalid id", async () => {
  setPollsCollection(createInMemoryPollsCollection());

  const response = await createRequest(server, "DELETE", "/polls/bad-id");

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Invalid poll id");
});
