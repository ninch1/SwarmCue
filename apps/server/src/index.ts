import { ProtocolVersion } from "@swarmcue/protocol";
import { createCoordinationServer } from "./server.js";

const port = Number(process.env.PORT) || 3001;

const { server } = createCoordinationServer();

server.listen(port, () => {
  console.log(
    `SwarmCue coordination server listening on http://localhost:${port} (protocol v${ProtocolVersion})`,
  );
});
