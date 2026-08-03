# Emoji Tennis Online

A real-time, two-player Pong-style tennis game in which players control avatars represented by emojis. A match takes place between two players connected simultaneously over the network, with state synchronized via WebSocket.

## Overview

The project consists of a Node.js server responsible for matchmaking players and validating/relaying gameplay events, and a web client that holds all rendering logic, match physics, and UI. There is no data persistence: matches, rooms, and scores exist only for the duration of the players' connections.

## Features

- Automatic matchmaking of two players into a game room.
- Character selection among twelve available emojis.
- Keyboard-driven paddle movement, synchronized in real time between the two clients.
- Collision physics with ball angle and speed varying according to where it hits the paddle.
- Sound effects generated via the Web Audio API, synchronized between both players.
- Scoring with a five-point limit and a victory screen at the end of the match, decided and confirmed by the server for both players.
- A custom visual theme, including animations for the waiting screen, scoreboard, and match end.
- Automatic reconnection in case of a dropped connection during a match, with a notice to the opponent and a grace period before the room is closed.
- Server-side validation of events received from clients, including paddle position, ball position, score, and sound effects.

## Technologies used

- Node.js
- Express, for the HTTP server and to serve the client's static files.
- Socket.IO, for real-time communication between server and clients.
- HTML5 Canvas, for rendering the game graphics in the browser.
- Web Audio API, for generating sound effects.

## Project structure

```
emoji-tennis-multiplayer/
├── package.json        Dependencies and server start script
├── server.js            Express/Socket.IO server: matchmaking and event relaying
└── public/
    └── index.html       Full client: UI, game logic, and real-time communication
```

## Requirements

- Node.js installed (the latest LTS version is recommended).
- npm, bundled with Node.js.

## Installation

Clone the repository and install the dependencies:

```
npm install
```

## Running the project

To start the server:

```
npm start
```

By default, the server starts on port 3000. The port can be changed via the `PORT` environment variable.

Once the server is running, open `http://localhost:3000` in the browser. To play a match, the address needs to be opened in two separate tabs, windows, or devices, simulating the two players.

## How to play

1. On the home screen, choose a character among the available emojis.
2. Click "Search Match" to enter the matchmaking queue.
3. Once a second player connects, the match starts automatically.
4. Control the paddle using the W and S keys, or the up and down arrow keys.
5. The first player to reach five points wins the match.

## Architecture and internal workings

The server does not simulate the game's physics. Its responsibility is limited to:

- Pairing the next connecting player with the player already waiting, creating a room identified by the combination of the two players' socket identifiers. Matchmaking is sequential (only one player waits to be paired at a time), but this does not limit the number of simultaneous rooms: each formed pair spawns an independent room, and new pairs keep being matched normally while earlier matches are still in progress.
- Validating and relaying events to the players in the same room: paddle movement, ball position, score, and sound effect triggers. The server checks that the sender actually belongs to the room and to the role (p1 or p2) it claims to have, clamps paddle and ball positions to the court boundaries, restricts the chosen emoji to the allowed list, validates sound parameters, and accepts score increments of only one point at a time, coming exclusively from the player acting as the physics authority (p1). Once a score reaches five points, the server itself declares the winner and notifies both players.
- Handling disconnections: when a player's connection is lost, the server notifies the opponent and keeps the room reserved for a grace period (20 seconds) before closing it, allowing the player to reconnect and resume the match from where it left off. If a player leaves voluntarily through the menu, the room is closed immediately.

The match simulation runs entirely on the client side, distributed across the two browsers:

- The player assigned as the room's first player is responsible for computing the ball physics (movement, collisions, and scoring) and sends that information to the opponent on every frame.
- The second player does not simulate the ball; it only renders the data received from the first player.
- Each player simulates their own paddle movement locally and sends its position to the opponent, with no reconciliation or correction on the receiving side.

This division of responsibilities means the accuracy of the match physics depends entirely on the connection of the player acting as the simulation authority.

## Known limitations

- Automatic reconnection only covers dropped connections during an ongoing match, within the same browser tab; if the page is reloaded or closed, the match state is lost and cannot be resumed.
- Server-side validation reduces the attack surface for a malicious client but does not eliminate the risk entirely: since the ball physics are still computed on the client acting as the authority (p1), that player can still, within the limits accepted by the server, send ball positions inconsistent with a real simulation.
- Player and room state is kept in memory only, and is lost on every server restart.
