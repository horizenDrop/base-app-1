export const gameAbi = [
  {
    type: "event",
    name: "ScoreSubmitted",
    inputs: [
      { indexed: true, name: "player", type: "address" },
      { indexed: false, name: "submittedScore", type: "uint256" },
      { indexed: false, name: "bestScore", type: "uint256" }
    ]
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "submitScore",
    inputs: [{ name: "score", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    stateMutability: "view",
    name: "bestScore",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

