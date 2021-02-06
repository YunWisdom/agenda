/* globals describe, it, beforeEach, afterEach */
"use strict";
const expect = require("expect.js");
const delay = require("delay");
const { MongoClient } = require("mongodb");
const { Agenda } = require("../dist");

const mongoHost = process.env.MONGODB_HOST || "localhost";
const mongoPort = process.env.MONGODB_PORT || "27017";
const agendaDatabase = "agenda-test";
const mongoCfg =
  "mongodb://" + mongoHost + ":" + mongoPort + "/" + agendaDatabase;

// Create agenda instances
let agenda = null;
let mongoDb = null;
let mongoClient = null;

const clearJobs = () => {
  return mongoDb.collection("agendaJobs").deleteMany({});
};

const jobType = "do work";
const jobProcessor = () => {};

describe("find-and-lock-next-job", () => {
  beforeEach((done) => {
    agenda = new Agenda(
      {
        db: {
          address: mongoCfg,
        },
      },
      (error) => {
        if (error) {
          done(error);
        }

        MongoClient.connect(
          mongoCfg,
          { useUnifiedTopology: true },
          async (error, client) => {
            mongoClient = client;
            mongoDb = client.db(agendaDatabase);

            await delay(50);
            await clearJobs();

            agenda.define("someJob", jobProcessor);
            agenda.define("send email", jobProcessor);
            agenda.define("some job", jobProcessor);
            agenda.define(jobType, jobProcessor);

            done();
          }
        );
      }
    );
  });

  afterEach(async () => {
    await delay(50);
    await agenda.stop();
    await clearJobs();
    await mongoClient.close();
    await agenda._db.close();
  });

  it("should find jobs with and without lockedAt property", async () => {
    const job = await agenda.create(jobType, {}).save();
    expect(job.attrs.lockedAt).to.equal(undefined);
    // The above line does not add `lockedAt` to DB. Nevertheless, let's delete it just in case.
    const { lastErrorObject, value } = await mongoDb
      .collection("agendaJobs")
      .findOneAndUpdate({ name: jobType }, { $unset: { lockedAt: "" } }); // deleting the property
    expect(lastErrorObject.updatedExisting).to.equal(true);
    expect(value.lockedAt).to.equal(undefined);
    expect(value.nextRunAt.getTime()).to.be.lessThan(Date.now() + 1000);

    agenda.processEvery(100);

    let processed = 0;
    const successPromise = new Promise((resolve) => {
      processed += 1;
      agenda.on(`success:${jobType}`, resolve);
    });

    await agenda.start();
    await successPromise;

    expect(processed).to.equal(1);
  });
});
