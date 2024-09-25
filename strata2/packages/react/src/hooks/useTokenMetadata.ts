import { PublicKey } from "@solana/web3.js";
import { ITokenWithMetaAndAccount } from "@strata-foundation/spl-token-collective";
import { useMintTokenRef } from "./tokenRef";
import { useMetaplexTokenMetadata } from "./useMetaplexMetadata";
import { useAsync } from "react-async-hook";

export interface IUseTokenMetadataResult extends ITokenWithMetaAndAccount {
  loading: boolean;
  error: Error | undefined;
}

/**
 * Get the token account and all metaplex + token collective metadata around the token
 *
 * @param token
 * @returns
 */
export function useTokenMetadata(
  token: PublicKey | undefined | null,
): IUseTokenMetadataResult {
  const fetchMetadata = async () => {
    if (!token) return null;

    const url = `https://mainnet.helius-rpc.com/?api-key=0d4b4fd6-c2fc-4f55-b615-a23bab1ffc85`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'my-id',
          method: 'getAsset',
          params: {
            id: token.toString(),
          },
        }),
      });

      const { result } = await response.json();
      
      if (result) {
        return {
          mint: result.mint,
          name: result.content.metadata.name,
          symbol: result.content.metadata.symbol,
          description: result.content.metadata.description,
          image: result.content.links.image,
          decimals: result.token_info.decimals,
          supply: result.token_info.supply,
        };
      }
    } catch (error) {
      console.error('Error fetching asset:', error);
      throw error;
    }
  };

  const { result: metadata, loading, error } = useAsync(fetchMetadata, [token]);

  return {
    ...metadata,
    loading,
    error,
    account: undefined,
  };
}
