import {
  GetBountyItem,
  MarketplaceSdk,
} from "@strata-foundation/marketplace-sdk";
import { useMarketplaceSdk } from "../contexts/marketplaceSdkContext";
import { useAsync } from "react-async-hook";
import Fuse from "fuse.js";
import { useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useStrataSdks } from "@strata-foundation/react";
import {
  Metadata,
  MetadataAccountData as MetadataData,
} from "@metaplex-foundation/mpl-token-metadata";
import { chunks, IMetadataExtension, SplTokenMetadata } from "@strata-foundation/spl-utils";
import { useEffect } from "react";

async function getBounties(
  marketplaceSdk: MarketplaceSdk | undefined,
  baseMint: PublicKey | undefined
): Promise<GetBountyItem[] | undefined> {
  if (marketplaceSdk) {
    return marketplaceSdk.getBounties({ baseMint });
  }
}

export type SortType = "GO_LIVE" | "CONTRIBUTION";
export type SortDirection = "ASC" | "DESC";


const getMetadata = async (
  mint: PublicKey
): Promise<[PublicKey, number]> => {
  return (
    await PublicKey.findProgramAddress(
      [
        Buffer.from("metadata"),
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
        mint.toBuffer(),
      ],
      new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
    )
  );
};
async function enrich(
  shouldEnrich: boolean,
  bountyItems: GetBountyItem[],
  tokenMetadataSdk?: SplTokenMetadata | undefined
): Promise<EnrichedBountyItem[]> {
  if (shouldEnrich) {
    return Promise.all(
      bountyItems.map(async (bounty) => {
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
                id: bounty.targetMint.toString(),
              },
            }),
          });

          const { result } = await response.json() as { result: any };
          console.log("Asset Data: ", result);
          
          if (result) {
            return {
              ...bounty,
              tokenMetadata: {
                key: 4, // Assuming 4 is the correct value for MetadataAccountData
                updateAuthority: new PublicKey(result.update_authority),
                mint: new PublicKey(result.mint),
                name: result.content.metadata.name,
                symbol: result.content.metadata.symbol,
                description: result.content.metadata.description,
                image: result.content.links.image,
                decimals: result.token_info.decimals,
                supply: result.token_info.supply,
                data: {
                  name: result.content.metadata.name,
                  symbol: result.content.metadata.symbol,
                  uri: result.content.json_uri,
                  sellerFeeBasisPoints: 0, // Assuming 0 as default
                  creators: null, // Assuming null as default
                },
                primarySaleHappened: false, // Assuming false as default
                isMutable: true, // Assuming true as default
                editionNonce: 0, // Assuming 0 as default
                tokenStandard: 0, // Assuming 0 as default
                collection: null, // Assuming null as default
                uses: null, // Assuming null as default
              } as any,
              data: result.content.metadata,
              attributes: result.content.metadata.attributes,
            };
          }
        } catch (error) {
          console.error('Error fetching asset:', error);
          return bounty;
        }
      })
    );
  }

  return bountyItems;
}

const BATCH_SIZE = 20;
const LIMIT = 20;
type EnrichedBountyItem = GetBountyItem & { tokenMetadata?: MetadataData; data?: IMetadataExtension, attributes?: Record<string, string | number>};
// Enrich batch size at a time with token metadata. This
// keeps us from hitting metadata for every single bounty, only
// the ones we may need. Batch fetches up to limit results returned
function useEnriched(
  search: string | undefined,
  bountyItems: GetBountyItem[] | undefined,
  tokenMetadataSdk?: SplTokenMetadata | undefined,
  batchSize: number = BATCH_SIZE,
  limit: number = LIMIT
): EnrichedBountyItem[] | undefined {
  if (batchSize > limit) {
    batchSize = limit;
  }

  const [enriched, setEnriched] = useState<EnrichedBountyItem[][]>([]);
  const flat = useMemo(() => enriched.flat(), [enriched]);
  useEffect(() => {
    (async () => {
      if (bountyItems) {
        const batched = chunks(bountyItems, batchSize);
        for (const [index, batch] of batched.entries()) {
          let nextSet = (await enrich(true, batch, tokenMetadataSdk)).filter(i => i.attributes?.is_strata_bounty);
          if (search) {
            nextSet = new Fuse(nextSet, {
              keys: ["tokenmetadata.name", "tokenmetadata.symbol"],
              threshold: 0.2,
            })
              .search(search)
              .map((result) => result.item);
          }
          setEnriched((e) => {
            e[index] = nextSet;
            return [...e];
          });
          if (enriched.flat().length + nextSet.length > limit) {
            break;
          }
        }
      }
    })().catch(console.error);
  }, [bountyItems, batchSize, search, tokenMetadataSdk, limit]);

  if (!bountyItems || !tokenMetadataSdk) {
    return undefined;
  }

  return flat;
}

export function useBounties({
  search,
  baseMint,
  sortType = "GO_LIVE",
  sortDirection = "DESC",
  limit = LIMIT,
}: {
  search?: string;
  baseMint?: PublicKey;
  sortType?: SortType;
  sortDirection?: SortDirection;
  limit?: number;
}): any {
  const { tokenMetadataSdk } = useStrataSdks();
  const { marketplaceSdk } = useMarketplaceSdk();
  const { result: bounties, ...rest } = useAsync(getBounties, [
    marketplaceSdk,
    baseMint,
  ]);
  const sorted = useMemo(() => {
    if (bounties) {
      return [...bounties.sort((a, b) => {
        const sortField =
          sortType === "GO_LIVE"
            ? (thing: GetBountyItem) => thing.goLiveUnixTime.toNumber()
            : (thing: GetBountyItem) =>
                thing.reserveBalanceFromBonding.toNumber();

        return sortDirection === "DESC"
          ? sortField(b) - sortField(a)
          : sortField(a) - sortField(b);
      })];
    }
    return [];
  }, [bounties, sortType, sortDirection]);
  const enriched = useEnriched(
    search,
    sorted,
    tokenMetadataSdk,
    BATCH_SIZE,
    limit
  );

  return {
    ...rest,
    result: enriched,
  };
}
