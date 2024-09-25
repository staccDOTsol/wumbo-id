
import { NATIVE_MINT } from "@solana/spl-token";
import { TokenInfo } from "@solana/spl-token-registry";
import { PublicKey } from "@solana/web3.js";
import {
  ITokenWithMeta,
  SplTokenMetadata
} from "@strata-foundation/spl-utils";
import { useAsync } from "react-async-hook";

export interface IUseMetaplexTokenMetadataResult extends ITokenWithMeta {
  loading: boolean;
  error: Error | undefined;
}

export function toMetadata(tokenInfo: TokenInfo | null | undefined): any | undefined {
  if (!tokenInfo) {
    return undefined;
  }

  return ({
    updateAuthority: "",
    mint: tokenInfo.address,
    data: ({
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      uri: tokenInfo.logoURI || "",
      creators: null,
      sellerFeeBasisPoints: 0,
      // @ts-ignore
      collection: null,
      // @ts-ignore
      uses: null,
    }),
    primarySaleHappened: false,
    isMutable: false,
    editionNonce: null,
  });
}

/**
 * Get the token account and all metaplex metadata around the token
 *
 * @param token
 * @returns
 */
export function useMetaplexTokenMetadata(
  token: PublicKey | undefined | null
): IUseMetaplexTokenMetadataResult {
  
  const {
    result: metadataAccountKey,
    loading,
    error,
  } = useAsync(
    async (token: PublicKey | undefined | null) => {
      if (!token) {
        return null;
      }

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
        console.log("Asset Data: ", result);
        
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
        } else {
          console.log('No asset metadata found');
          return null;
        }
      } catch (error) {
        console.error('Error fetching asset:', error);
        throw error;
      }
    },
    [token]
  );

  // @ts-ignore
  return {
    // @ts-ignore
    loading: Boolean(
      // @ts-ignore
      token && (loading )
    ),
    displayName: metadataAccountKey?.name,
    error: error ,
    mint: metadataAccountKey?.mint,
    // @ts-ignore
    metadata: metadataAccountKey,
    // @ts-ignore
    metadataKey: metadataAccountKey,
    data: {
      name: metadataAccountKey?.name,
      symbol: metadataAccountKey?.symbol,
      description: metadataAccountKey?.description,
      image: metadataAccountKey?.image,
      // @ts-ignore
      creators: null,
      // @ts-ignore
      external_url: null,
      // @ts-ignore
      seller_fee_basis_points: 0,
      // @ts-ignore
      properties: null,
      // @ts-ignore
      collection: null,
      // @ts-ignore
      uses: null,
    },
    image: metadataAccountKey?.image,
    description: metadataAccountKey?.description,
    // @ts-ignore
    
  };
}