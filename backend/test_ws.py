import asyncio
import websockets
import json

async def run_smoke_test():
    uri = "ws://127.0.0.1:8000/ws/train"
    async with websockets.connect(uri) as websocket:
        data = {
            "step_id": 1,
            "angles": {
                "knee_right": 70
            }
        }

        await websocket.send(json.dumps(data))
        response = await websocket.recv()
        print("Server:", response)

if __name__ == "__main__":
    asyncio.run(run_smoke_test())
