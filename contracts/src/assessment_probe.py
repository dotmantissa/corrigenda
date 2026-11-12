class AssessmentProbe(gl.Contract):
    court: Address
    results: TreeMap[str,str]

    def __init__(self, court: str):
        self.court=Address(court)

    @gl.public.write
    def assess(self, request_id: str) -> None:
        packet=gl.get_contract_at(self.court).view().get_request(request_id)
        result=assess_consensus(packet)
        self.results[request_id]=canonical(result)

    @gl.public.view
    def get_result(self, request_id: str) -> dict:
        return json.loads(self.results[request_id])
