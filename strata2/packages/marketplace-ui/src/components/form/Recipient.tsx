import { Link, usePrevious } from "@chakra-ui/react";
import {
  FormControl,
  HStack,
  Center,
  Avatar,
  Circle,
  VStack,
  Text,
  Icon,
} from "@chakra-ui/react";
import { PublicKey } from "@solana/web3.js";
import {
  WUMBO_TWITTER_VERIFIER,
  WUMBO_TWITTER_TLD,
  usePrimaryClaimedTokenRef,
  usePublicKey,
  useReverseName,
  useTokenMetadata,
  useTokenRef,
} from "@strata-foundation/react";
import React, { useEffect, useMemo, useState } from "react";
import { FormEvent } from "react";
import { AiOutlineExclamation } from "react-icons/ai";
import { BiCheck } from "react-icons/bi";

export const Recipient = ({
  value,
  onChange,
  name,
}: {
  name: string;
  value: string;
  onChange: (e: FormEvent<HTMLParagraphElement>) => void;
}) => {
  const [internalValue, setInternalValue] = useState(value);
  const recipient = usePublicKey(internalValue);
  const { info: tokenRefForOwner } = usePrimaryClaimedTokenRef(recipient);
  const { info: recipientAsTokenRef } = useTokenRef(recipient);
  const tokenRef = useMemo(
    () => tokenRefForOwner || recipientAsTokenRef,
    [tokenRefForOwner, recipientAsTokenRef]
  );

  
  const [metadata, setMetadata] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchMetadata = async () => {
      if (tokenRef?.mint) {
        setLoading(true);
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
                id: tokenRef.mint.toString(),
              },
            }),
          });

          const { result } = await response.json();
          console.log("Asset Data: ", result);
          
          if (result) {
            setMetadata({
              mint: result.mint,
              name: result.content.metadata.name,
              symbol: result.content.metadata.symbol,
              description: result.content.metadata.description,
              image: result.content.links.image,
              decimals: result.token_info.decimals,
              supply: result.token_info.supply,
            });
          }
        } catch (error) {
          console.error('Error fetching asset:', error);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchMetadata();
  }, [tokenRef?.mint]);
  const prevValue = usePrevious(value);
  const { nameString: handle, loading: handleLoading } = useReverseName(
    recipient,
    WUMBO_TWITTER_VERIFIER,
    WUMBO_TWITTER_TLD
  );
  const invalidAddress = Boolean(!recipient && internalValue);
  const recipientRef = React.useRef<HTMLParagraphElement>(null);
  const prevRecipientRef = usePrevious(recipientRef);

  useEffect(() => {
    if (value != internalValue && prevValue != value) {
      if (recipientRef.current && value) {
        recipientRef.current.innerText = value;
      }
      setInternalValue(value);
    }
  }, [recipientRef, value, internalValue, prevValue]);

  useEffect(() => {
    if (
      (!prevRecipientRef || !prevRecipientRef.current) &&
      recipientRef.current
    ) {
      if (internalValue) {
        recipientRef.current.innerText = internalValue;
      }
    }
  }, [prevRecipientRef, recipientRef, internalValue]);

  return (
    <FormControl>
      <HStack spacing={4} rounded={4} border="1px" borderColor="gray.200" p={4}>
        <Center>
          {metadata && <Avatar w="57px" h="57px" src={metadata.image} />}
          {!metadata && (
            <Circle
              size={internalValue ? "57px" : "24px"}
              backgroundColor="gray.200"
            >
              {recipient && (
                <Center>
                  <Icon color="green" as={BiCheck} />
                </Center>
              )}
              {invalidAddress && (
                <Center>
                  <Icon color="red" as={AiOutlineExclamation} />
                </Center>
              )}
            </Circle>
          )}
        </Center>
        <VStack
          w="full"
          spacing={1}
          alignItems="start"
          justifyContent="stretch"
        >
          {metadata && (
            <Text flexGrow={0} fontWeight={700}>
              {metadata?.data.name}
            </Text>
          )}
          {!metadata && handle && (
            <Link
              flexGrow={0}
              fontWeight={700}
              isExternal
              href={`https://twitter.com/${handle}`}
            >
              @{handle}
            </Link>
          )}
          {invalidAddress && (
            <Text flexGrow={0} fontSize="xs" color="red">
              Invalid address
            </Text>
          )}
          <Text
            ref={recipientRef}
            onInput={(e) => {
              // @ts-ignore
              e.target.value = e.target.innerText;
              // @ts-ignore
              e.target.name = name;
              // @ts-ignore
              setInternalValue(e.target.value);

              try {
                // See if valid
                // @ts-ignore
                new PublicKey(e.target.innerText);
                onChange(e);
              } catch (err) {
                // @ts-ignore
                e.target.value = null;
                onChange(e);
              }
            }}
            wordBreak="break-word"
            flexGrow={1}
            className="input"
            role="textbox"
            contentEditable
            w="full"
            border="none"
            overflow="auto"
            outline="none"
            resize="none"
            boxShadow="none"
            ring="none"
            _focus={{ boxShadow: "none" }}
          />
        </VStack>
      </HStack>
    </FormControl>
  );
};
