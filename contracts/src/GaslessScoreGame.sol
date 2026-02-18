// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract GaslessScoreGame {
    mapping(address => uint256) public bestScore;

    event ScoreSubmitted(address indexed player, uint256 submittedScore, uint256 bestScore);

    function submitScore(uint256 score) external {
        if (score > bestScore[msg.sender]) {
            bestScore[msg.sender] = score;
        }

        emit ScoreSubmitted(msg.sender, score, bestScore[msg.sender]);
    }
}

