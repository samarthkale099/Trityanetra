def reverse_text(source):
    # build the reversed string one character at a time
    output = ""
    size = len(source)

    for piece in source:
        output = piece + output

    return output
