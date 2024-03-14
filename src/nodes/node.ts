import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";
import { delay } from "../utils";

async function broadcastMessage(N: number, basePath: string, message: object) {
  const fetchPromises = [];
  for (let i = 0; i < N; i++) {
    const fetchPromise = fetch(`http://localhost:${BASE_NODE_PORT + i}${basePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    }).catch(err => console.error(`Error sending message to node ${i}:`, err));
    fetchPromises.push(fetchPromise);
  }
  await Promise.all(fetchPromises);
}

async function sendMessage(toNode: number, message: object) {
  await fetch(`http://localhost:${BASE_NODE_PORT + toNode}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  }).catch(err => console.error(`Error sending message to node ${toNode}:`, err));
}

function processProposal(proposals: Value[], N: number, F: number): Value {
  const counts = proposals.reduce<{ [key: string]: number }>((acc, val) => {
    const key = val.toString(); 
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Compare counts with N / 2, casting the keys back to numbers where necessary
  if (counts['0'] > N / 2) return 0;
  if (counts['1'] > N / 2) return 1;
  return "?";
}

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let currentNodeState: NodeState = {
    killed: isFaulty,
    x: initialValue,
    decided: false,
    k: null,
  };



  // TODO implement this
  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send('faulty');
    } else {
      res.status(200).send('live');
    }
  });

  node.get("/stop", async (req, res) => {
    currentNodeState.killed = true;
    currentNodeState.x = null;
    currentNodeState.decided = null;
    currentNodeState.k = null;
    res.status(200).send("stopped");
  });

  // TODO implement this
  // get the current state of a node
  // node.get("/getState", (req, res) => {});
  node.get("/getState", (req, res) => {
    if (currentNodeState.killed) {
      res.json({
        killed: true,
        x: null,
        decided: null,
        k: null,
      });
    } else {
      res.json(currentNodeState);
    }
  });



  // TODO implement this
  // this route allows the node to receive messages from other nodes
  // node.post("/message", (req, res) => {});
 let messageRecords = new Map<number, Value[]>();

  node.post("/message", async (req, res) => {
    const { k, x, messageType } = req.body;

    if (!isFaulty && !currentNodeState.killed && ['propose', 'vote'].includes(messageType)) {
      messageRecords.set(k, [...(messageRecords.get(k) || []), x]);

      const messages = messageRecords.get(k) || [];
      if (messages.length >= N - F) {
        let consensusValue = processProposal(messages, N, F);

        if (messageType === "propose") {
          for (let i = 0; i < N; i++) {
            sendMessage(i, { k, x: consensusValue, messageType: "vote" });
          }
        } else if (messageType === "vote") {
          const decisionValue = processProposal(messages, N, F);
          if (decisionValue !== "?") {
            currentNodeState.decided = true;
            currentNodeState.x = decisionValue;
          } else {
            currentNodeState.x = Math.random() < 0.5 ? 0 : 1;
            if (currentNodeState.k !== null) {
              currentNodeState.k++;
            } else {
              currentNodeState.k = 1;
            }
            for (let i = 0; i < N; i++) {
              sendMessage(i, { k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" });
            }
          }
        }
      }
    }

    res.status(200).send("Message processed.");
  });

  
  // TODO implement this
  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(5);
    }

    if (!isFaulty) {
      currentNodeState.k = 1;
      currentNodeState.x = initialValue;
      currentNodeState.decided = false;

      const message = {
        k: currentNodeState.k,
        x: currentNodeState.x,
        nodeId: nodeId, // Assuming you want to know who sent the message
        messageType: "propose"
      };

      await broadcastMessage(N, "/message", message);
    } else {
      currentNodeState = { killed: true, x: null, decided: null, k: null };
    }

    res.status(200).send("Consensus algorithm started.");
  });


  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
