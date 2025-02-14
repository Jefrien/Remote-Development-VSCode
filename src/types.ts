export interface ServerItem {
    name: string;
    host: string;
    username: string;
    password: string;
    port: number;
    path: string;
}

export interface FTPNode {
    type:       string;
    name:       string;
    size:       number;
    modifyTime: number;
    accessTime: number;
    rights:     Rights;
    owner:      number;
    group:      number;
    longname:   string;
    path:       string;
    remotePath: string;
    parent:     FTPNode;
    isExpanded?: boolean;
    description?: string;
}

export interface Rights {
    user:  string;
    group: string;
    other: string;
}
