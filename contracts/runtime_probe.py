# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

class RuntimeProbe(gl.Contract):
    owner: Address
    received: TreeMap[str, str]

    def __init__(self):
        self.owner = gl.message.sender_address

    @gl.public.write
    def ping(self, destination: str, operation: str) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("[EXPECTED] Owner required")
        gl.get_contract_at(Address(destination)).emit(on="finalized").receive(operation)

    @gl.public.write
    def receive(self, operation: str) -> None:
        self.received[operation] = str(gl.message.sender_address)

    @gl.public.view
    def get(self, operation: str) -> str:
        return self.received.get(operation, "")
