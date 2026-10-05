export type DotnetContainerArch = 'arm64' | 'x64'

export type DotnetDownload = { name: string; url: string; sha512: string }

const RELEASES = 'https://builds.dotnet.microsoft.com/dotnet'

// Why these: SDK 3.1 for repos whose global.json pins it, ASP.NET 5.0 for net5.0 apps, SDK 10 for
// everything else (it builds every older target). 2.x is absent: its runtime crashes on arm64.
// Why 10.0 last: each archive carries the `dotnet` host, and the newest one has to win.
export const DOTNET_CONTAINER_DOWNLOADS: Record<DotnetContainerArch, readonly DotnetDownload[]> = {
  arm64: [
    {
      name: 'SDK 3.1.426',
      url: `${RELEASES}/Sdk/3.1.426/dotnet-sdk-3.1.426-linux-arm64.tar.gz`,
      sha512:
        '300e154fba3123644910bbb89a6e61f67569677efa359aa110871cbbb62afad059709dc362f0af27ece0b9a30bc3e6ef57c3cb7c6f75377b20d48636605f30f7'
    },
    {
      name: 'ASP.NET Core runtime 5.0.17',
      url: `${RELEASES}/aspnetcore/Runtime/5.0.17/aspnetcore-runtime-5.0.17-linux-arm64.tar.gz`,
      sha512:
        'ac1a9d89f1b730dfdca9c2e48373ef21f8f9316014eefbe6b11516f8195d3b3efc4e482883774b74ea2ff1cb77174a2cb471bd1157ab5b7d71621e3026c38e9b'
    },
    {
      name: 'SDK 10.0.201',
      url: `${RELEASES}/Sdk/10.0.201/dotnet-sdk-10.0.201-linux-arm64.tar.gz`,
      sha512:
        '98015bc0decaa0aba0cd61a82d5b9e2df882c1406dcd5574de639cbd2e0764066dc5488dde8f704351c5420ae730a2a39f7b7e789f280f1fb42b90871dda3ecb'
    }
  ],
  x64: [
    {
      name: 'SDK 3.1.426',
      url: `${RELEASES}/Sdk/3.1.426/dotnet-sdk-3.1.426-linux-x64.tar.gz`,
      sha512:
        '6c3f9541557feb5d5b93f5c10b28264878948e8540f2b8bb7fb966c32bd38191e6b310dcb5f87a4a8f7c67a7046fa932cde3cce9dc8341c1365ae6c9fcc481ec'
    },
    {
      name: 'ASP.NET Core runtime 5.0.17',
      url: `${RELEASES}/aspnetcore/Runtime/5.0.17/aspnetcore-runtime-5.0.17-linux-x64.tar.gz`,
      sha512:
        'd8e87804e9e86273c6512785bd5a6f0e834ff3f4bbebc11c4fcdf16ab4fdfabd0d981a756955267c1aa9bbeec596de3728ce9b2e6415d2d80daef0d999a5df6d'
    },
    {
      name: 'SDK 10.0.201',
      url: `${RELEASES}/Sdk/10.0.201/dotnet-sdk-10.0.201-linux-x64.tar.gz`,
      sha512:
        'a33354e3291aa21ea5e1983733f001d45264c31ee3c0dc4a85509d4cb6d4896cfec57fd2143a7b54c93bc42b328e059b16802b4085257a367ef2652f1c8fa424'
    }
  ]
}

/**
 * netcoredbg baked into the image. Why 3.1.0-1031: later builds need glibc 2.32+, and the image
 * is Ubuntu 20.04 (2.31) because .NET Core 3.1 needs its OpenSSL 1.1.
 */
export const CONTAINER_NETCOREDBG: Record<DotnetContainerArch, { url: string; sha256: string }> = {
  arm64: {
    url: 'https://github.com/Samsung/netcoredbg/releases/download/3.1.0-1031/netcoredbg-linux-arm64.tar.gz',
    sha256: '2419a6b34c7d25541a4bca9f140c137bdd6f6a3b5693d2f79bc04c930061ffa3'
  },
  x64: {
    url: 'https://github.com/Samsung/netcoredbg/releases/download/3.1.0-1031/netcoredbg-linux-amd64.tar.gz',
    sha256: '0eab16af3a54513803eb89266adaa9a9a0c5bc52a42d5659e381d664665f353e'
  }
}

/**
 * `dotnet ef` for 2.x/3.1 projects: migrations run the startup project on its own runtime, which
 * only the container has. The nupkg is any-CPU; its hash is NuGet's catalog packageHash.
 */
export const CONTAINER_DOTNET_EF = {
  version: '3.1.32',
  url: 'https://api.nuget.org/v3-flatcontainer/dotnet-ef/3.1.32/dotnet-ef.3.1.32.nupkg',
  sha512:
    'e06ff7055cfa50445e3e404b0c3fbf4292937c21929fd411d7c30027cf5de2db4b47f9d5d39f2c0d5b355f6da0667169266e89ae2041736050fa70bba69294ee'
}
