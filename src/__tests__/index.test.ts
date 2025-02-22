/**
 * @jest-environment ceramic
 */

import NftResolver, { NftResovlerConfig } from '../index';
import { Resolver, ResolverRegistry } from 'did-resolver';
import { EthereumAuthProvider } from '@ceramicnetwork/blockchain-utils-linking';
import * as u8a from 'uint8arrays';
import fetchMock from 'jest-fetch-mock';
import { ethers } from 'ethers'
import { NftDidVectorBuilder, NftDidVector } from '../testUtils/NftDidVector';

const ERC721_QUERY_URL = 'https://api.thegraph.com/subgraphs/name/wighawag/eip721-subgraph';
const ERC1155_QUERY_URL = 'https://api.thegraph.com/subgraphs/name/amxx/eip1155-subgraph';
const BLOCK_QUERY_URL = 'https://api.thegraph.com/subgraphs/name/yyong1010/ethereumblocks';

const ETH_CAIP2_CHAINID = 'eip155:1';

const erc721Contract = '0x7e789e2dd1340971de0a9bca35b14ac0939aa330';
const erc721Owner = '0x431cf61e7aff8e68142f6263e9fadde40aff8c7d';
const erc721OwnerResponse = { data: { tokens: [ { owner: { id: erc721Owner } } ] } };
const erc721NoResponse = { data: { tokens: [ ] } };

const erc1155Contract = '0x06eb48572a2ef9a3b230d69ca731330793b65bdc';
const erc1155Owners = [ '0xef1bd3fc679a6f0cd296b59aff99ddc21409869f', '0x5bb822302e78c978f3d73cd7565ad92240779cae', '0xa84de981f6f6d2d78e8d59239db73c89f058cb58' ];
const erc1155Accounts = erc1155Owners.map(owner => { return { account: { id: owner } } } );
const erc1155OwnersResponse = { data: { tokens: [ { balances: erc1155Accounts } ] } };
const erc1155NoResponse = { data: { tokens: [ { balances: [ ] } ] } };

const blockQueryNumber = '1234567';
const blockQueryResponse = { data: { blocks: [ { number: blockQueryNumber } ] } };

const caipLinkControllerDid = 'did:3:testing';

enum ErcNamespace {
  ERC721 = 'erc721',
  ERC1155 = 'erc1155'
}

describe('NFT DID Resolver (TheGraph)', () => {
  let config: NftResovlerConfig;
  let nftResolver: ResolverRegistry;
  let resolver: Resolver;

  let ethAccount: string;
  let ethAuthProv: EthereumAuthProvider;


  beforeAll(async () => {
    config = {
      ceramic: ceramic
    };

    nftResolver = NftResolver.getResolver(config);
    resolver = new Resolver(nftResolver);

    
    // Set up the EthAuthProvider
    const ethRpcProvider = new ethers.providers.JsonRpcProvider('http://localhost:8545')
    const ethSigner = ethRpcProvider.getSigner(1);
    ethAccount = (await ethSigner.getAddress()).toLowerCase()

    ethAuthProv = createEthAuthProvider(ethSigner, ethAccount);
    await createCaip10Link(ethAuthProv, config.ceramic);
  });

  it('getResolver works correctly', () => {
    expect(Object.keys(nftResolver)).toEqual(['nft']);
  });

  describe('nft-did-resolver config', () => {

    it('does not throw with valid customSubgraphs', () => {
      const customConfig = {
        ceramic: ceramic,
        subGraphUrls: {
          'eip155:1': {
            erc721: ERC721_QUERY_URL,
            erc1155: ERC1155_QUERY_URL,
          }
        }
      } as NftResovlerConfig;
  
      expect(() => NftResolver.getResolver(customConfig))
        .not.toThrow();
    });

    it('throws when erc721 subGraphUrls is not a url', () => {
      const badUrl = 'aoeuaoeu';
      const customConfig = {
        ceramic: ceramic,
        subGraphUrls: {
          'eip155:1': {
            erc721: badUrl
          }
        }
      } as NftResovlerConfig;
  
      expect(() => NftResolver.getResolver(customConfig))
        .toThrowError(`Invalid config for nft-did-resolver: Invalid URL: ${badUrl}`);
    });
  
    it('throws when erc1155 subGraphUrls is not a url', () => {
      const badUrl = 'http: //api.thegraph.com/subgraphs/name/wighawag/eip721-subgraph';
      const customConfig = {
        ceramic: ceramic,
        subGraphUrls: {
          'eip155:1': {
            erc1155: badUrl
          }
        }
      } as NftResovlerConfig;
      expect(() => NftResolver.getResolver(customConfig))
        .toThrowError(`Invalid config for nft-did-resolver: Invalid URL: ${badUrl}`);
    });

    it('throws when the caip2 chainId is malformed', () => {
      const customConfig = {
        ceramic: ceramic,
        subGraphUrls: {
          'eip155.1': {
            erc1155: ERC1155_QUERY_URL
          }
        }
      } as NftResovlerConfig;
      expect(() => NftResolver.getResolver(customConfig))
        .toThrowError('Invalid config for nft-did-resolver: Invalid chainId provided: eip155.1');
    });
  });

  describe('ERC721 NFTs', () => {

    let nftVectorBuilder: NftDidVectorBuilder;

    beforeEach(() => {
      fetchMock.resetMocks();
      fetchMock.mockIf(ERC721_QUERY_URL);

      nftVectorBuilder = new NftDidVectorBuilder(ETH_CAIP2_CHAINID, ErcNamespace.ERC721);
    });

    it('resolves an erc721 nft document without caip10-link', async () => {
      fetchMock.once(JSON.stringify(erc721OwnerResponse));

      const nftVector = nftVectorBuilder
        .setNftContract(erc721Contract)
        .setNftId('1')
        .setNftOwners([erc721Owner])
        .build();

      await expectVectorResult(resolver, nftVector);
    });

    it('resolves an erc721 nft document with caip10-link', async () => {
      fetchMock.once(JSON.stringify(erc721OwnerResponse).replace(erc721Owner, ethAccount));

      const nftVector = nftVectorBuilder
        .setNftContract(erc721Contract)
        .setNftId('2')
        .setNftOwners([ethAccount]) // notice the eth account here
        .setCaip10Controller(caipLinkControllerDid)
        .build();

      await expectVectorResult(resolver, nftVector);
    });

    it('resolves an erc721 nft doc with an older timestamp', async () => {
      fetchMock.mockOnceIf(BLOCK_QUERY_URL, JSON.stringify(blockQueryResponse));
      fetchMock.mockOnceIf(ERC721_QUERY_URL, JSON.stringify(erc721OwnerResponse));

      const versionTime = "2021-03-16T10:05:21.000Z";

      const nftVector = nftVectorBuilder
        .setNftContract(erc721Contract)
        .setNftId('1')
        .setNftOwners([erc721Owner])
        .setVersionTime(versionTime)
        .build();

      // when versionTime is provided, it should ask for the block number at that time, 
      // and subsequently get the owner at that time.

      expect(await resolver.resolve(nftVector.getDidWithVersionTime()))
        .toEqual(nftVector.getResult());

      expectBlockQueries(versionTime);
    });

    it('throws on invalid ERC721 contract', async () => {
      fetchMock.once(JSON.stringify(erc721NoResponse));
      const invalidContract = '0x1234567891234567891234567891234596351156';
      const tokenId = '1';

      const nftVector = nftVectorBuilder
      .setNftContract(invalidContract)
      .setNftId(tokenId)
      .setErrorMessage(`Error: No owner found for ERC721 NFT ID: ${tokenId} for contract: ${invalidContract}`)
      .build();
    
      await expectVectorResult(resolver, nftVector);
    });

    it('throws on non-existent ERC721 token with valid contract', async () => {
      fetchMock.once(JSON.stringify(erc721NoResponse));
      const tokenId = '12345678910';

      const nftVector = nftVectorBuilder
        .setNftContract(erc721Contract)
        .setNftId(tokenId)
        .setErrorMessage(`Error: No owner found for ERC721 NFT ID: ${tokenId} for contract: ${erc721Contract}`)
        .build();
      
      await expectVectorResult(resolver, nftVector);
    });

    it('throws when an invalid erc namespace is provided in DID', async () => {
      const tokenId = '1';
      const badNamespace = 'erc123';

      const nftVector = new NftDidVectorBuilder(ETH_CAIP2_CHAINID, badNamespace)
        .setNftContract(erc721Contract)
        .setNftId(tokenId)
        .setErrorMessage(`Error: Only erc721 and erc1155 namespaces are currently supported. Given: ${badNamespace}`)
        .build();
      
      await expectVectorResult(resolver, nftVector);
    });

    it('resolves erc721 dids with a custom subgraph url', async () => {
      const custom721Subgraph = 'https://api.thegraph.com/subgraphs/name/dvorak/aoeu';
      fetchMock.mockIf(custom721Subgraph);
      fetchMock.mockOnceIf(custom721Subgraph, JSON.stringify(erc721OwnerResponse));

      const customConfig = {
        ceramic: ceramic,
        subGraphUrls: {
          'eip155:1': {
            erc721: custom721Subgraph
          }
        }
      } as NftResovlerConfig;
  
      const customResolver = new Resolver(NftResolver.getResolver(customConfig));

      const nftVector = nftVectorBuilder
        .setNftContract(erc721Contract)
        .setNftId('1')
        .setNftOwners([erc721Owner])
        .build();

      await expectVectorResult(customResolver, nftVector);
      expect(fetchMock.mock.calls[0][0]).toEqual(custom721Subgraph);
    });

    it('allows for erc721 namespace on caip2 chains beside eth', async () => {
      const cosmosCaip2Id = 'cosmos:iov-nftnet';
      const cosmos721Subgraph = 'http://api.thegraph.com/subgraphs/name/cosmos/721-subgraph';
      fetchMock.mockOnceIf(cosmos721Subgraph, JSON.stringify(erc721OwnerResponse));

      const customConfig = {
        ceramic: ceramic,
        subGraphUrls: {
          'cosmos:iov-nftnet': {
            erc721: cosmos721Subgraph
          }
        }
      } as NftResovlerConfig;

      const customResolver = new Resolver(NftResolver.getResolver(customConfig));

      const nftVector = new NftDidVectorBuilder(cosmosCaip2Id, ErcNamespace.ERC721)
        .setNftContract(erc721Contract)
        .setNftOwners([erc721Owner])
        .setNftId('1')
        .build();
    
      await expectVectorResult(customResolver, nftVector);
    });
  });

  
  describe('ERC1155 NFTs', () => {

    let nftVectorBuilder: NftDidVectorBuilder;

    beforeEach(() => {
      fetchMock.resetMocks();
      fetchMock.mockIf(ERC1155_QUERY_URL);

      nftVectorBuilder = new NftDidVectorBuilder(ETH_CAIP2_CHAINID, ErcNamespace.ERC1155);
    });

    it('resolves an erc1155 nft document without caip10-link', async () => {
      fetchMock.once(JSON.stringify(erc1155OwnersResponse));

      const nftVector = nftVectorBuilder
        .setNftContract(erc1155Contract)
        .setNftId('1')
        .setNftOwners(erc1155Owners)
        .build();

      await expectVectorResult(resolver, nftVector);
    });

    it('resolves an erc1155 nft document with caip10-link', async () => {
      // we want to have the eth account be returned because it IS the caip10-link
      fetchMock.once(JSON.stringify(erc1155OwnersResponse).replace(erc1155Owners[0], ethAccount));
      const newOwners = [...erc1155Owners];
      newOwners.splice(0, 1, ethAccount);

      const nftVector = nftVectorBuilder
        .setNftContract(erc1155Contract)
        .setNftId('1')
        .setNftOwners(newOwners)
        .setCaip10Controller(caipLinkControllerDid)
        .build();

      await expectVectorResult(resolver, nftVector);
    });

    it('resolves an erc1155 nft doc with an older timestamp', async () => {
      fetchMock.mockOnceIf(BLOCK_QUERY_URL, JSON.stringify(blockQueryResponse));
      fetchMock.mockOnceIf(ERC1155_QUERY_URL, JSON.stringify(erc1155OwnersResponse));

      const versionTime = "2021-03-16T10:05:21.000Z";

      const nftVector = nftVectorBuilder
        .setNftContract(erc1155Contract)
        .setNftId('1')
        .setNftOwners(erc1155Owners)
        .setVersionTime(versionTime)
        .build();

      // when versionTime is provided, it should ask for the block number at that time, 
      // and subsequently get the owner at that time.

      expect(await resolver.resolve(nftVector.getDidWithVersionTime()))
        .toEqual(nftVector.getResult());

      expectBlockQueries(versionTime);
    });

    it('throws on invalid ERC1155 contract', async () => {
      fetchMock.once(JSON.stringify(erc1155NoResponse));
      const invalidContract = '0x9876543219876543219876543219876543219876';
      const tokenId = '1';

      const nftVector = nftVectorBuilder
        .setNftContract(invalidContract)
        .setNftId(tokenId)
        .setErrorMessage(`Error: No owner found for ERC1155 NFT ID: ${tokenId} for contract: ${invalidContract}`)
        .build();
        
        await expectVectorResult(resolver, nftVector);
      });

    it('throws on non-existent ERC1155 token with valid contract', async () => {
      fetchMock.once(JSON.stringify(erc1155NoResponse));
      const badTokenId = '12345678910';

      const nftVector = nftVectorBuilder
        .setNftContract(erc1155Contract)
        .setNftId(badTokenId)
        .setErrorMessage(`Error: No owner found for ERC1155 NFT ID: ${badTokenId} for contract: ${erc1155Contract}`)
        .build();

      await expectVectorResult(resolver, nftVector);
    });

    it('resolves erc1155 dids with a custom subgraph url', async () => {
      const custom1155Subgraph = 'http://api.thegraph.com/subgraphs/name/aoeuaoeudhtn/subgraph';
      fetchMock.mockOnceIf(custom1155Subgraph, JSON.stringify(erc1155OwnersResponse));

      const customConfig = {
        ceramic: ceramic,
        subGraphUrls: {
          'eip155:1': {
            erc1155: custom1155Subgraph
          }
        }
      } as NftResovlerConfig;
  
      const customResolver = new Resolver(NftResolver.getResolver(customConfig));

      const nftVector = nftVectorBuilder
        .setNftContract(erc1155Contract)
        .setNftId('1')
        .setNftOwners(erc1155Owners)
        .build();

      await expectVectorResult(customResolver, nftVector);
      expect(fetchMock.mock.calls[0][0]).toEqual(custom1155Subgraph);
    });

    it('allows for erc1155 namespace on caip2 chains beside eth', async () => {
      const cosmosCaip2Id = 'cosmos:iov-mainnet';
      const custom1155Subgraph = 'http://api.thegraph.com/subgraphs/name/cosmos/subgraph';
      fetchMock.mockOnceIf(custom1155Subgraph, JSON.stringify(erc1155OwnersResponse));

      const customConfig = {
        ceramic: ceramic,
        subGraphUrls: {
          'cosmos:iov-mainnet': {
            erc1155: custom1155Subgraph
          }
        }
      } as NftResovlerConfig;

      const customResolver = new Resolver(NftResolver.getResolver(customConfig));

      const nftVector = new NftDidVectorBuilder(cosmosCaip2Id, ErcNamespace.ERC1155)
        .setNftContract(erc1155Contract)
        .setNftOwners(erc1155Owners)
        .setNftId('1')
        .build();
    
      await expectVectorResult(customResolver, nftVector);
    });
  });
});

const expectVectorResult = async (resolver: Resolver, nftVector: NftDidVector) => {
  expect(await resolver.resolve(nftVector.nftDid))
    .toEqual(nftVector.getResult());
}

// a helper to do the same operation as in the resolver
const isoTimeToTimestamp = (versionTime: string) => {
  return Math.floor((new Date(versionTime)).getTime() / 1000);
}


function expectBlockQueries(versionTime: string) {
  // Note: For each indexed call, the 0th elem is the url, and the 1st elem is what was sent to fetch
  // the first call will be to query the block at timestamp
  expect(fetchMock.mock.calls[0][0]).toEqual(BLOCK_QUERY_URL);

  // check that the call includes the timestamp
  expect(fetchMock.mock.calls[0][1].body.toString()
    .includes(`timestamp_lte: ${isoTimeToTimestamp(versionTime)}`))
    .toBe(true);

  // check that the call to the NFT subgraph includes the mocked block number
  expect(fetchMock.mock.calls[1][1].body.toString()
    .includes(`number: ${blockQueryNumber}`))
    .toBe(true);
}

async function createCaip10Link(ethAuthProv: EthereumAuthProvider) {
  const proof = await ethAuthProv.createLink(caipLinkControllerDid);
  const doc = await ceramic.createDocument('caip10-link', {
    metadata: { family: 'caip10-link', controllers: [proof.account] }
  });
  await doc.change({ content: proof });
}

function createEthAuthProvider(ethSigner: ethers.providers.JsonRpcSigner, ethAccount: string) {
  return new EthereumAuthProvider({
    send: async (data, cb) => {
      if (data.method === 'eth_chainId') {
        cb(null, { result: '0x1' });
      } else if (data.method === 'eth_getCode') {
        cb(null, { result: '0x' });
      } else {
        // it's personal_sign
        const msg = u8a.toString(u8a.fromString(data.params[0].slice(2), 'base16'));
        const sign = await ethSigner.signMessage(msg);
        cb(null, { result: sign });
      }
    }
  }, ethAccount);
}
