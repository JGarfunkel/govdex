// A NY government jurisdiction's own website should be on a .gov/.us/.org
// domain, not a commercial .com one — a .com is a purchasable domain the
// jurisdiction doesn't control the renewal/registration chain of the way it
// does a .gov, and easily confused with an unrelated commercial site of the
// same name.
export function hostnameIsDotCom(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith(".com");
  } catch {
    return false;
  }
}
