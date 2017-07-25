import Promise from 'bluebird';
import MongoDb from 'mongodb';

const MongoClient = Promise.promisifyAll(MongoDb.MongoClient);

export function getDbConnection(url) {
    return new Promise((resolve, reject) => {
        MongoClient.connect(url).then((db) => {
            resolve(db);
        })
    });
}