export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fromToken, toToken, fromAmount, fromAddress } = req.query;
    if (!fromToken || !toToken || !fromAmount || !fromAddress) {
      return res.status(400).json({ error: 'Missing required params: fromToken, toToken, fromAmount, fromAddress' });
    }

    const params = new URLSearchParams({
      fromChain: '5000',
      toChain: '5000',
      fromToken,
      toToken,
      fromAmount,
      fromAddress,
      slippage: '0.005',
    });

    const lifiRes = await fetch(`https://li.quest/v1/quote?${params}`);

    if (!lifiRes.ok) {
      const errText = await lifiRes.text();
      return res.status(lifiRes.status).json({ error: 'LI.FI quote failed', details: errText });
    }

    const data = await lifiRes.json();

    const safe = {
      tool: data.tool,
      toolName: data.toolDetails?.name,
      transactionId: data.transactionId,
      estimate: {
        approvalAddress: data.estimate?.approvalAddress,
        fromAmount: data.estimate?.fromAmount,
        toAmount: data.estimate?.toAmount,
        toAmountMin: data.estimate?.toAmountMin,
        fromAmountUSD: data.estimate?.fromAmountUSD,
        toAmountUSD: data.estimate?.toAmountUSD,
        executionDuration: data.estimate?.executionDuration,
        gasCosts: data.estimate?.gasCosts,
        feeCosts: data.estimate?.feeCosts,
      },
      transactionRequest: {
        to: data.transactionRequest?.to,
        data: data.transactionRequest?.data,
        value: data.transactionRequest?.value,
        gasLimit: data.transactionRequest?.gasLimit,
        gasPrice: data.transactionRequest?.gasPrice,
        chainId: data.transactionRequest?.chainId,
      },
    };

    return res.status(200).json(safe);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
